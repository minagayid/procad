use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::SaltString,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::{StatusCode, header::AUTHORIZATION},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use procad_core::dental::{Tooth, tooth_from_fdi};
use procad_core::mesh::SourceUnit;
use procad_core::scan::{ScanFormat, ScanRecord, ScanProcessing, ingest_scan};
use procad_core::libraries::library_sources;
use procad_core::workflow::{
    CaseStage, TransitionContext, UserRole, authorize_transition,
};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool, sqlite::SqlitePoolOptions};
use std::{env, net::SocketAddr, path::PathBuf, str::FromStr};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Error)]
enum ApiError {
    #[error("invalid request: {0}")]
    BadRequest(&'static str),
    #[error("authentication required")]
    Unauthorized,
    #[error("operation is not permitted for this role")]
    Forbidden,
    #[error("resource was not found")]
    NotFound,
    #[error("resource already exists or state conflicts")]
    Conflict,
    #[error("case workflow transition was rejected")]
    InvalidTransition,
    #[error("database or service error")]
    Internal,
    #[error("initial administrator already exists")]
    BootstrapClosed,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Conflict | Self::BootstrapClosed => StatusCode::CONFLICT,
            Self::InvalidTransition => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(ErrorBody { error: self.to_string() })).into_response()
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Debug, Clone)]
struct AuthenticatedUser {
    id: String,
    email: String,
    role: UserRole,
}

#[derive(Debug, Serialize)]
struct PublicUser {
    id: String,
    email: String,
    role: UserRole,
}

#[derive(Debug, Deserialize)]
struct Credentials {
    email: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct SessionResponse {
    access_token: String,
    token_type: &'static str,
    expires_in_seconds: i64,
    user: PublicUser,
}


#[derive(Debug, Deserialize)]
struct CreateUser {
    email: String,
    password: String,
    role: String,
}

#[derive(Debug, Serialize)]
struct ScanUploadResponse {
    id: String,
    storage_key: String,
    record: ScanRecord,
}

fn parse_source_unit(value: &str) -> Result<SourceUnit, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "mm" | "millimeter" | "millimeters" => Ok(SourceUnit::Millimeter),
        "cm" | "centimeter" | "centimeters" => Ok(SourceUnit::Centimeter),
        "m" | "meter" | "meters" => Ok(SourceUnit::Meter),
        "in" | "inch" | "inches" => Ok(SourceUnit::Inch),
        _ => Err(ApiError::BadRequest("source units must be mm, cm, m or in")),
    }
}

fn scan_format_name(value: ScanFormat) -> &'static str {
    match value {
        ScanFormat::Stl => "stl",
        ScanFormat::Obj => "obj",
        ScanFormat::Ply => "ply",
        ScanFormat::Off => "off",
        ScanFormat::Xyz => "xyz",
        ScanFormat::Pts => "pts",
        ScanFormat::Csv => "csv",
        ScanFormat::Pcd => "pcd",
    }
}

fn scan_processing_name(value: &ScanProcessing) -> &'static str {
    match value {
        ScanProcessing::ValidatedMesh { .. } => "validated_mesh",
        ScanProcessing::RecognizedAwaitingParser => "recognized_awaiting_parser",
        ScanProcessing::PointCloudAwaitingParser => "point_cloud_awaiting_parser",
    }
}

#[derive(Debug, Deserialize)]
struct CreatePatient {
    patient_ref: String,
    label: String,
}

#[derive(Debug, Serialize)]
struct PatientResponse {
    id: String,
    patient_ref: String,
    label: String,
}

#[derive(Debug, Deserialize)]
struct CreateCase {
    patient_id: String,
    title: String,
}

#[derive(Debug, Serialize)]
struct CaseResponse {
    id: String,
    patient_id: String,
    title: String,
    stage: String,
    created_by: String,
}

#[derive(Debug, Deserialize)]
struct TransitionRequest {
    to: String,
    reason: String,
}


#[derive(Debug, Deserialize)]
struct CaseToothInput {
    fdi: u8,
    restoration_type: String,
}

#[derive(Debug, Serialize)]
struct CaseToothResponse {
    tooth: Tooth,
    restoration_type: String,
}

fn arch_name(value: procad_core::dental::Arch) -> &'static str {
    match value {
        procad_core::dental::Arch::Maxillary => "maxillary",
        procad_core::dental::Arch::Mandibular => "mandibular",
    }
}

fn dentition_name(value: procad_core::dental::Dentition) -> &'static str {
    match value {
        procad_core::dental::Dentition::Permanent => "permanent",
        procad_core::dental::Dentition::Primary => "primary",
    }
}

fn tooth_kind_name(value: procad_core::dental::ToothKind) -> &'static str {
    match value {
        procad_core::dental::ToothKind::Incisor => "incisor",
        procad_core::dental::ToothKind::Canine => "canine",
        procad_core::dental::ToothKind::Premolar => "premolar",
        procad_core::dental::ToothKind::Molar => "molar",
    }
}


#[derive(Debug, Deserialize)]
struct CreateDesignRevision {
    artifact_sha256: String,
    geometry_engine: String,
    geometry_engine_version: String,
    design_type: String,
}

#[derive(Debug, Serialize)]
struct DesignRevisionResponse {
    id: String,
    case_id: String,
    revision_number: i64,
    artifact_sha256: String,
    geometry_engine: String,
    geometry_engine_version: String,
    design_type: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct ReviewDecisionInput {
    decision: String,
    reason: String,
}

#[derive(Debug, Serialize)]
struct ReviewDecisionResponse {
    approval_id: String,
    design_revision_id: String,
    decision: String,
    case_stage: String,
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Debug, Serialize)]
struct TransitionResponse {
    case_id: String,
    from: String,
    to: String,
    event_id: String,
}

async fn require_auth(
    State(pool): State<SqlitePool>,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    let token = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned);

    let Some(token) = token else {
        return ApiError::Unauthorized.into_response();
    };

    let token_hash = hex::encode(Sha256::digest(token.as_bytes()));
    let row = match sqlx::query(
        "SELECT users.id, users.email, users.role
         FROM sessions
         INNER JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > unixepoch()",
    )
    .bind(token_hash)
    .fetch_optional(&pool)
    .await
    {
        Ok(value) => value,
        Err(_) => return ApiError::Internal.into_response(),
    };

    let Some(row) = row else {
        return ApiError::Unauthorized.into_response();
    };

    let user = match (
        row.try_get::<String, _>("id"),
        row.try_get::<String, _>("email"),
        row.try_get::<String, _>("role"),
    ) {
        (Ok(id), Ok(email), Ok(role)) => AuthenticatedUser {
            id,
            email,
            role: parse_role(&role),
        },
        _ => return ApiError::Internal.into_response(),
    };

    request.extensions_mut().insert(user);
    next.run(request).await
}

fn parse_role(value: &str) -> UserRole {
    match value {
        "admin" => UserRole::Admin,
        "clinician" => UserRole::Clinician,
        "technician" => UserRole::Technician,
        _ => UserRole::Viewer,
    }
}

fn public_user(user: &AuthenticatedUser) -> PublicUser {
    PublicUser {
        id: user.id.clone(),
        email: user.email.clone(),
        role: user.role,
    }
}

fn require_write_role(user: &AuthenticatedUser) -> Result<(), ApiError> {
    if matches!(user.role, UserRole::Admin | UserRole::Clinician | UserRole::Technician) {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

fn validate_credentials(email: &str, password: &str) -> Result<(), ApiError> {
    if !email.contains('@') || email.trim().len() < 5 || email.len() > 254 {
        return Err(ApiError::BadRequest("email address is invalid"));
    }
    if password.len() < 12 || password.len() > 128 {
        return Err(ApiError::BadRequest("password must contain 12 to 128 bytes"));
    }
    Ok(())
}

fn password_hash(password: &str) -> Result<String, ApiError> {
    let mut rng = OsRng;
    let salt = SaltString::generate(&mut rng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::Internal)
}

fn verify_password(password: &str, encoded_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(encoded_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "procad-api",
        "mode": "local-first"
    }))
}

/// One-time bootstrap. This route can only create the first administrator,
/// and rejects every subsequent call once an account exists.
async fn bootstrap(
    State(pool): State<SqlitePool>,
    Json(input): Json<Credentials>,
) -> ApiResult<PublicUser> {
    validate_credentials(&input.email, &input.password)?;
    let mut transaction = pool.begin().await.map_err(|_| ApiError::Internal)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| ApiError::Internal)?;
    if count != 0 {
        return Err(ApiError::BootstrapClosed);
    }

    let id = Uuid::new_v4().to_string();
    let email = input.email.trim().to_ascii_lowercase();
    let encoded = password_hash(&input.password)?;
    sqlx::query("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
        .bind(&id)
        .bind(&email)
        .bind(&encoded)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            if matches!(error, sqlx::Error::Database(_)) {
                ApiError::Conflict
            } else {
                ApiError::Internal
            }
        })?;
    transaction.commit().await.map_err(|_| ApiError::Internal)?;
    Ok(Json(PublicUser {
        id,
        email,
        role: UserRole::Admin,
    }))
}

async fn login(
    State(pool): State<SqlitePool>,
    Json(input): Json<Credentials>,
) -> ApiResult<SessionResponse> {
    if input.email.trim().is_empty() || input.password.is_empty() {
        return Err(ApiError::BadRequest("email and password are required"));
    }
    let row = sqlx::query("SELECT id, email, password_hash, role FROM users WHERE email = ? COLLATE NOCASE")
        .bind(input.email.trim())
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;

    let encoded_hash: String = row.try_get("password_hash").map_err(|_| ApiError::Internal)?;
    if !verify_password(&input.password, &encoded_hash) {
        return Err(ApiError::Unauthorized);
    }

    let user = AuthenticatedUser {
        id: row.try_get("id").map_err(|_| ApiError::Internal)?,
        email: row.try_get("email").map_err(|_| ApiError::Internal)?,
        role: parse_role(&row.try_get::<String, _>("role").map_err(|_| ApiError::Internal)?),
    };

    let mut token_bytes = [0_u8; 32];
    let mut rng = OsRng;
    rng.fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);
    let token_hash = hex::encode(Sha256::digest(token.as_bytes()));
    let expires_in_seconds = 12 * 60 * 60;
    let expires_at = Utc::now().timestamp() + expires_in_seconds;
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(&user.id)
        .bind(token_hash)
        .bind(expires_at)
        .execute(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;

    Ok(Json(SessionResponse {
        access_token: token,
        token_type: "Bearer",
        expires_in_seconds,
        user: public_user(&user),
    }))
}

async fn me(Extension(user): Extension<AuthenticatedUser>) -> ApiResult<PublicUser> {
    Ok(Json(public_user(&user)))
}

async fn libraries(Extension(_user): Extension<AuthenticatedUser>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "sources": library_sources(),
        "note": "Catalog metadata only. External geometry must be imported with its license and attribution; no proprietary vendor libraries are bundled."
    }))
}

async fn create_patient(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(input): Json<CreatePatient>,
) -> ApiResult<PatientResponse> {
    require_write_role(&user)?;
    if input.patient_ref.trim().is_empty()
        || input.patient_ref.len() > 96
        || input.label.trim().is_empty()
        || input.label.len() > 160
    {
        return Err(ApiError::BadRequest("patient_ref and label are required and must be within length limits"));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO patients (id, patient_ref, label, created_by) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(input.patient_ref.trim())
        .bind(input.label.trim())
        .bind(&user.id)
        .execute(&pool)
        .await
        .map_err(|error| {
            if matches!(error, sqlx::Error::Database(_)) { ApiError::Conflict } else { ApiError::Internal }
        })?;
    Ok(Json(PatientResponse {
        id,
        patient_ref: input.patient_ref.trim().to_owned(),
        label: input.label.trim().to_owned(),
    }))
}

async fn create_case(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateCase>,
) -> ApiResult<CaseResponse> {
    require_write_role(&user)?;
    if input.patient_id.trim().is_empty() || input.title.trim().is_empty() || input.title.len() > 180 {
        return Err(ApiError::BadRequest("patient_id and a short case title are required"));
    }
    let patient_exists: Option<String> = sqlx::query_scalar("SELECT id FROM patients WHERE id = ?")
        .bind(input.patient_id.trim())
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    if patient_exists.is_none() {
        return Err(ApiError::NotFound);
    }
    let id = Uuid::new_v4().to_string();
    let title = input.title.trim().to_owned();
    sqlx::query("INSERT INTO cases (id, patient_id, title, created_by) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(input.patient_id.trim())
        .bind(&title)
        .bind(&user.id)
        .execute(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    Ok(Json(CaseResponse {
        id,
        patient_id: input.patient_id,
        title,
        stage: CaseStage::Intake.as_str().to_owned(),
        created_by: user.id,
    }))
}

async fn list_cases(
    State(pool): State<SqlitePool>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> ApiResult<Vec<CaseResponse>> {
    let rows = sqlx::query(
        "SELECT id, patient_id, title, stage, created_by FROM cases ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|_| ApiError::Internal)?;

    let mut cases = Vec::with_capacity(rows.len());
    for row in rows {
        cases.push(CaseResponse {
            id: row.try_get("id").map_err(|_| ApiError::Internal)?,
            patient_id: row.try_get("patient_id").map_err(|_| ApiError::Internal)?,
            title: row.try_get("title").map_err(|_| ApiError::Internal)?,
            stage: row.try_get("stage").map_err(|_| ApiError::Internal)?,
            created_by: row.try_get("created_by").map_err(|_| ApiError::Internal)?,
        });
    }
    Ok(Json(cases))
}

async fn transition_case(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(case_id): Path<String>,
    Json(input): Json<TransitionRequest>,
) -> ApiResult<TransitionResponse> {
    let row = sqlx::query("SELECT stage, created_by FROM cases WHERE id = ?")
        .bind(&case_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?
        .ok_or(ApiError::NotFound)?;
    let from_text: String = row.try_get("stage").map_err(|_| ApiError::Internal)?;
    let creator_id: String = row.try_get("created_by").map_err(|_| ApiError::Internal)?;
    let from = CaseStage::from_str(&from_text).map_err(|_| ApiError::Internal)?;
    let to = CaseStage::from_str(&input.to).map_err(|_| ApiError::BadRequest("unknown case stage"))?;
    if to == CaseStage::ClinicallyApproved {
        return Err(ApiError::InvalidTransition);
    }
    let context = TransitionContext {
        actor_id: &user.id,
        case_creator_id: &creator_id,
        role: user.role,
        reason: &input.reason,
    };
    authorize_transition(from, to, &context).map_err(|_| ApiError::InvalidTransition)?;

    let mut transaction = pool.begin().await.map_err(|_| ApiError::Internal)?;
    if from == CaseStage::Design && to == CaseStage::Review {
        let revisions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM design_revisions WHERE case_id = ? AND status = 'draft'",
        )
        .bind(&case_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| ApiError::Internal)?;
        if revisions == 0 {
            return Err(ApiError::Conflict);
        }
        sqlx::query("UPDATE design_revisions SET status = 'ready_for_review' WHERE case_id = ? AND status = 'draft'")
            .bind(&case_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiError::Internal)?;
    }
    let changed = sqlx::query(
        "UPDATE cases SET stage = ?, updated_at = unixepoch() WHERE id = ? AND stage = ?",
    )
    .bind(to.as_str())
    .bind(&case_id)
    .bind(&from_text)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiError::Internal)?;
    if changed.rows_affected() != 1 {
        return Err(ApiError::Conflict);
    }
    let event_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO case_events (id, case_id, actor_id, from_stage, to_stage, reason) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&event_id)
    .bind(&case_id)
    .bind(&user.id)
    .bind(from.as_str())
    .bind(to.as_str())
    .bind(input.reason.trim())
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiError::Internal)?;
    transaction.commit().await.map_err(|_| ApiError::Internal)?;
    Ok(Json(TransitionResponse {
        case_id,
        from: from.as_str().to_owned(),
        to: to.as_str().to_owned(),
        event_id,
    }))
}



async fn create_user(
    State(pool): State<SqlitePool>,
    Extension(actor): Extension<AuthenticatedUser>,
    Json(input): Json<CreateUser>,
) -> ApiResult<PublicUser> {
    if actor.role != UserRole::Admin {
        return Err(ApiError::Forbidden);
    }
    validate_credentials(&input.email, &input.password)?;
    let role = match input.role.as_str() {
        "admin" => UserRole::Admin,
        "clinician" => UserRole::Clinician,
        "technician" => UserRole::Technician,
        "viewer" => UserRole::Viewer,
        _ => return Err(ApiError::BadRequest("role must be admin, clinician, technician or viewer")),
    };
    let id = Uuid::new_v4().to_string();
    let email = input.email.trim().to_ascii_lowercase();
    let encoded = password_hash(&input.password)?;
    sqlx::query("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&email)
        .bind(&encoded)
        .bind(match role {
            UserRole::Admin => "admin",
            UserRole::Clinician => "clinician",
            UserRole::Technician => "technician",
            UserRole::Viewer => "viewer",
        })
        .execute(&pool)
        .await
        .map_err(|error| {
            if matches!(error, sqlx::Error::Database(_)) { ApiError::Conflict } else { ApiError::Internal }
        })?;
    Ok(Json(PublicUser { id, email, role }))
}

async fn upload_scan(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(case_id): Path<String>,
    mut multipart: Multipart,
) -> ApiResult<ScanUploadResponse> {
    require_write_role(&user)?;
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM cases WHERE id = ?")
        .bind(&case_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    if exists.is_none() {
        return Err(ApiError::NotFound);
    }

    let mut filename: Option<String> = None;
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut unit_text: Option<String> = None;
    while let Some(field) = multipart.next_field().await.map_err(|_| ApiError::BadRequest("malformed multipart upload"))? {
        match field.name().unwrap_or_default() {
            "file" => {
                if file_bytes.is_some() {
                    return Err(ApiError::BadRequest("upload exactly one scan file"));
                }
                filename = Some(field.file_name().unwrap_or("scan").to_owned());
                let data = field.bytes().await.map_err(|_| ApiError::BadRequest("could not read scan upload"))?;
                file_bytes = Some(data.to_vec());
            }
            "units" => {
                if unit_text.is_some() {
                    return Err(ApiError::BadRequest("provide source units once"));
                }
                unit_text = Some(field.text().await.map_err(|_| ApiError::BadRequest("invalid units field"))?);
            }
            _ => return Err(ApiError::BadRequest("multipart fields must be named file and units")),
        }
    }

    let filename = filename.ok_or(ApiError::BadRequest("file field is required"))?;
    let bytes = file_bytes.ok_or(ApiError::BadRequest("file field is required"))?;
    let source_units = parse_source_unit(unit_text.as_deref().ok_or(ApiError::BadRequest("units field is required"))?)?;
    let (record, _validated_mesh) = ingest_scan(&filename, &bytes, source_units)
        .map_err(|_| ApiError::BadRequest("scan format, coordinates, units or geometry validation failed"))?;

    let extension = filename.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    let id = Uuid::new_v4().to_string();
    let storage_name = format!("{id}.{extension}");
    let root = PathBuf::from(env::var("PROCAD_SCAN_STORE").unwrap_or_else(|_| "procad-data/scans".to_owned()));
    tokio::fs::create_dir_all(&root).await.map_err(|_| ApiError::Internal)?;
    let destination = root.join(&storage_name);
    tokio::fs::write(&destination, &bytes).await.map_err(|_| ApiError::Internal)?;
    let storage_key = storage_name.clone();

    let insert = sqlx::query(
        "INSERT INTO scan_assets
         (id, case_id, original_filename, format, source_units, byte_length, sha256, intake_status, storage_key, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&case_id)
    .bind(&record.original_filename)
    .bind(scan_format_name(record.format))
    .bind(match record.source_units {
        SourceUnit::Millimeter => "millimeter",
        SourceUnit::Centimeter => "centimeter",
        SourceUnit::Meter => "meter",
        SourceUnit::Inch => "inch",
    })
    .bind(record.byte_length as i64)
    .bind(&record.sha256)
    .bind(scan_processing_name(&record.processing))
    .bind(&storage_key)
    .bind(&user.id)
    .execute(&pool)
    .await;

    if insert.is_err() {
        let _ = tokio::fs::remove_file(destination).await;
        return Err(ApiError::Internal);
    }
    Ok(Json(ScanUploadResponse { id, storage_key, record }))
}


async fn create_design_revision(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(case_id): Path<String>,
    Json(input): Json<CreateDesignRevision>,
) -> ApiResult<DesignRevisionResponse> {
    require_write_role(&user)?;
    if !valid_sha256(&input.artifact_sha256) {
        return Err(ApiError::BadRequest("artifact_sha256 must be a 64-character SHA-256 checksum"));
    }
    if input.geometry_engine.trim().is_empty()
        || input.geometry_engine.len() > 80
        || input.geometry_engine_version.trim().is_empty()
        || input.geometry_engine_version.len() > 80
        || input.design_type.trim().is_empty()
        || input.design_type.len() > 80
    {
        return Err(ApiError::BadRequest("geometry engine, version and design type are required"));
    }
    let stage: Option<String> = sqlx::query_scalar("SELECT stage FROM cases WHERE id = ?")
        .bind(&case_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    if stage.as_deref() != Some("design") {
        return Err(if stage.is_some() { ApiError::Conflict } else { ApiError::NotFound });
    }
    let mut transaction = pool.begin().await.map_err(|_| ApiError::Internal)?;
    let revision_number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM design_revisions WHERE case_id = ?",
    )
    .bind(&case_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| ApiError::Internal)?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO design_revisions
         (id, case_id, revision_number, artifact_sha256, geometry_engine, geometry_engine_version, design_type, status, authored_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
    )
    .bind(&id)
    .bind(&case_id)
    .bind(revision_number)
    .bind(&input.artifact_sha256)
    .bind(input.geometry_engine.trim())
    .bind(input.geometry_engine_version.trim())
    .bind(input.design_type.trim())
    .bind(&user.id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiError::Internal)?;
    transaction.commit().await.map_err(|_| ApiError::Internal)?;
    Ok(Json(DesignRevisionResponse {
        id,
        case_id,
        revision_number,
        artifact_sha256: input.artifact_sha256,
        geometry_engine: input.geometry_engine,
        geometry_engine_version: input.geometry_engine_version,
        design_type: input.design_type,
        status: "draft".into(),
    }))
}

async fn approve_design_revision(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(revision_id): Path<String>,
    Json(input): Json<ReviewDecisionInput>,
) -> ApiResult<ReviewDecisionResponse> {
    if user.role != UserRole::Clinician {
        return Err(ApiError::Forbidden);
    }
    if input.reason.trim().is_empty() || input.reason.len() > 2000 {
        return Err(ApiError::BadRequest("review reason is required and must be under 2,000 bytes"));
    }
    if !matches!(input.decision.as_str(), "approved" | "rejected") {
        return Err(ApiError::BadRequest("decision must be approved or rejected"));
    }

    let row = sqlx::query(
        "SELECT design_revisions.case_id, design_revisions.authored_by, design_revisions.status,
                cases.created_by, cases.stage
         FROM design_revisions
         INNER JOIN cases ON cases.id = design_revisions.case_id
         WHERE design_revisions.id = ?",
    )
    .bind(&revision_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| ApiError::Internal)?
    .ok_or(ApiError::NotFound)?;
    let case_id: String = row.try_get("case_id").map_err(|_| ApiError::Internal)?;
    let author_id: String = row.try_get("authored_by").map_err(|_| ApiError::Internal)?;
    let revision_status: String = row.try_get("status").map_err(|_| ApiError::Internal)?;
    let case_creator_id: String = row.try_get("created_by").map_err(|_| ApiError::Internal)?;
    let case_stage: String = row.try_get("stage").map_err(|_| ApiError::Internal)?;

    if case_stage != "review" || revision_status != "ready_for_review" {
        return Err(ApiError::Conflict);
    }
    if user.id == author_id || user.id == case_creator_id {
        return Err(ApiError::InvalidTransition);
    }

    let mut transaction = pool.begin().await.map_err(|_| ApiError::Internal)?;
    let approval_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO clinical_approvals (id, design_revision_id, reviewer_id, decision, reason)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&approval_id)
    .bind(&revision_id)
    .bind(&user.id)
    .bind(&input.decision)
    .bind(input.reason.trim())
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        if matches!(error, sqlx::Error::Database(_)) { ApiError::Conflict } else { ApiError::Internal }
    })?;

    let resulting_stage = if input.decision == "approved" {
        let context = TransitionContext {
            actor_id: &user.id,
            case_creator_id: &case_creator_id,
            role: user.role,
            reason: &input.reason,
        };
        authorize_transition(CaseStage::Review, CaseStage::ClinicallyApproved, &context)
            .map_err(|_| ApiError::InvalidTransition)?;
        sqlx::query("UPDATE design_revisions SET status = 'approved' WHERE id = ?")
            .bind(&revision_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiError::Internal)?;
        let case_update = sqlx::query("UPDATE cases SET stage = 'clinically_approved', updated_at = unixepoch() WHERE id = ? AND stage = 'review'")
            .bind(&case_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiError::Internal)?;
        if case_update.rows_affected() != 1 {
            return Err(ApiError::Conflict);
        }
        sqlx::query(
            "INSERT INTO case_events (id, case_id, actor_id, from_stage, to_stage, reason)
             VALUES (?, ?, ?, 'review', 'clinically_approved', ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&case_id)
        .bind(&user.id)
        .bind(input.reason.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiError::Internal)?;
        "clinically_approved"
    } else {
        sqlx::query("UPDATE design_revisions SET status = 'rejected' WHERE id = ?")
            .bind(&revision_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiError::Internal)?;
        "review"
    };
    transaction.commit().await.map_err(|_| ApiError::Internal)?;
    Ok(Json(ReviewDecisionResponse {
        approval_id,
        design_revision_id: revision_id,
        decision: input.decision,
        case_stage: resulting_stage.into(),
    }))
}

async fn upsert_case_tooth(
    State(pool): State<SqlitePool>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(case_id): Path<String>,
    Json(input): Json<CaseToothInput>,
) -> ApiResult<CaseToothResponse> {
    require_write_role(&user)?;
    let tooth = tooth_from_fdi(input.fdi).map_err(|_| ApiError::BadRequest("invalid FDI tooth number"))?;
    let allowed = [
        "none", "crown", "inlay", "onlay", "veneer", "bridge_abutment",
        "bridge_pontic", "implant_crown", "implant_abutment", "denture_tooth",
    ];
    if !allowed.contains(&input.restoration_type.as_str()) {
        return Err(ApiError::BadRequest("unsupported restoration type"));
    }
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM cases WHERE id = ?")
        .bind(&case_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    if exists.is_none() {
        return Err(ApiError::NotFound);
    }

    let universal = tooth.universal.map(i64::from);
    let primary_universal = tooth.primary_universal.map(|value| value.to_string());
    sqlx::query(
        "INSERT INTO case_teeth
         (case_id, fdi, universal, primary_universal, arch, dentition, tooth_kind, restoration_type, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(case_id, fdi) DO UPDATE SET
           universal = excluded.universal,
           primary_universal = excluded.primary_universal,
           arch = excluded.arch,
           dentition = excluded.dentition,
           tooth_kind = excluded.tooth_kind,
           restoration_type = excluded.restoration_type,
           updated_by = excluded.updated_by,
           updated_at = unixepoch()",
    )
    .bind(&case_id)
    .bind(i64::from(tooth.fdi))
    .bind(universal)
    .bind(primary_universal)
    .bind(arch_name(tooth.arch))
    .bind(dentition_name(tooth.dentition))
    .bind(tooth_kind_name(tooth.kind))
    .bind(&input.restoration_type)
    .bind(&user.id)
    .execute(&pool)
    .await
    .map_err(|_| ApiError::Internal)?;

    Ok(Json(CaseToothResponse {
        tooth,
        restoration_type: input.restoration_type,
    }))
}

async fn list_case_teeth(
    State(pool): State<SqlitePool>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(case_id): Path<String>,
) -> ApiResult<Vec<CaseToothResponse>> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM cases WHERE id = ?")
        .bind(&case_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    if exists.is_none() {
        return Err(ApiError::NotFound);
    }

    let rows = sqlx::query("SELECT fdi, restoration_type FROM case_teeth WHERE case_id = ? ORDER BY fdi")
        .bind(&case_id)
        .fetch_all(&pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    let mut output = Vec::with_capacity(rows.len());
    for row in rows {
        let fdi: i64 = row.try_get("fdi").map_err(|_| ApiError::Internal)?;
        let fdi = u8::try_from(fdi).map_err(|_| ApiError::Internal)?;
        let tooth = tooth_from_fdi(fdi).map_err(|_| ApiError::Internal)?;
        output.push(CaseToothResponse {
            tooth,
            restoration_type: row.try_get("restoration_type").map_err(|_| ApiError::Internal)?,
        });
    }
    Ok(Json(output))
}

pub fn app(pool: SqlitePool) -> Router {
    let protected = Router::new()
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/users", post(create_user))
        .route("/api/v1/libraries", get(libraries))
        .route("/api/v1/patients", post(create_patient))
        .route("/api/v1/cases", get(list_cases).post(create_case))
        .route("/api/v1/cases/{id}/transitions", post(transition_case))
        .route("/api/v1/cases/{id}/design-revisions", post(create_design_revision))
        .route("/api/v1/design-revisions/{id}/approval", post(approve_design_revision))
        .route("/api/v1/cases/{id}/teeth", get(list_case_teeth).post(upsert_case_tooth))
        .route("/api/v1/cases/{id}/scans", post(upload_scan).layer(DefaultBodyLimit::max(256 * 1024 * 1024)))
        .route_layer(middleware::from_fn_with_state(pool.clone(), require_auth));

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/bootstrap", post(bootstrap))
        .route("/api/v1/auth/login", post(login))
        .merge(protected)
        .with_state(pool)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let database_url = env::var("PROCAD_DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://procad.sqlite?mode=rwc".to_owned());
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let bind = env::var("PROCAD_BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:4180".to_owned());
    let address: SocketAddr = bind.parse()?;
    if !address.ip().is_loopback()
        && env::var("PROCAD_ALLOW_REMOTE_BIND").unwrap_or_default() != "true"
    {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "non-loopback binding requires PROCAD_ALLOW_REMOTE_BIND=true and a secured deployment").into());
    }
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "procad API listening");
    axum::serve(listener, app(pool)).await?;
    Ok(())
}
