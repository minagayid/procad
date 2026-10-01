import { createHash, randomUUID } from 'node:crypto';

export const EVENT_TYPES = Object.freeze([
  'service.created', 'service.completed', 'service.cancelled',
  'lab_order.created', 'lab_order.completed', 'cad_job.completed', 'cam_job.completed',
  'material.received', 'material.consumed', 'material.returned',
  'invoice.created', 'invoice.issued', 'invoice.modified', 'invoice.cancelled', 'invoice.credit_note',
  'payment.created', 'payment.completed', 'payment.refunded', 'receipt.created',
  'inventory.adjusted', 'reconciliation.started', 'reconciliation.completed',
  'compliance.signal_created', 'compliance.case_created', 'compliance.case_resolved'
]);

export const DEFAULT_RULES = Object.freeze([
  { id: 'SERVICE_WITHOUT_INVOICE', source: 'services', target: 'invoices', condition: 'target_missing', severity: 'medium' },
  { id: 'PAYMENT_WITHOUT_INVOICE', source: 'payments', target: 'invoices', condition: 'target_missing', severity: 'high' },
  { id: 'INVOICE_PAYMENT_MISMATCH', source: 'invoices', target: 'payments', condition: 'amount_mismatch', severity: 'medium' },
  { id: 'INVENTORY_PRODUCTION_VARIANCE', source: 'inventory', target: 'production', condition: 'quantity_mismatch', severity: 'medium' },
  { id: 'DUPLICATE_INVOICE', source: 'invoices', target: 'invoices', condition: 'duplicate', severity: 'high' }
]);

const severityWeight = { low: 20, medium: 45, high: 75, critical: 95 };
const transitions = {
  OPEN: ['TRIAGED'], TRIAGED: ['UNDER_REVIEW'], UNDER_REVIEW: ['EVIDENCE_REQUESTED', 'RESOLVED', 'ESCALATED'],
  EVIDENCE_REQUESTED: ['UNDER_REVIEW', 'RESOLVED', 'ESCALATED'], RESOLVED: [], ESCALATED: []
};

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}

export function sha256(value) { return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex'); }

export function createEvent(input = {}) {
  if (!EVENT_TYPES.includes(input.event_type)) throw new Error(`Unsupported event type: ${input.event_type}`);
  if (!input.transaction_id || !input.organization_id) throw new Error('transaction_id and organization_id are required.');
  const event = {
    event_id: input.event_id || `EVT-${new Date().getUTCFullYear()}-${randomUUID()}`,
    transaction_id: String(input.transaction_id), organization_id: String(input.organization_id),
    event_type: input.event_type, occurred_at: input.occurred_at || new Date().toISOString(),
    actor_id: input.actor_id || null, source: input.source || 'procad',
    amount: input.amount == null ? null : Number(input.amount), currency: input.currency || 'EGP',
    tax_category: input.tax_category || null, entity_id: input.entity_id || null, metadata: input.metadata || {},
    previous_event_hash: input.previous_event_hash || null
  };
  if (!Number.isFinite(event.amount) && event.amount !== null) throw new Error('amount must be finite.');
  event.event_hash = sha256({ ...event, event_hash: undefined });
  return event;
}

export function verifyEventChain(events = []) {
  let previous = null;
  for (const event of events) {
    const expected = sha256({ ...event, event_hash: undefined });
    if (event.previous_event_hash !== previous || event.event_hash !== expected) return { valid: false, events: events.length, chain_verified: false, failed_event_id: event.event_id };
    previous = event.event_hash;
  }
  return { valid: true, events: events.length, chain_verified: true, head_hash: previous };
}

const tx = (row) => String(row.transaction_id || row.transactionId || '');
const amount = (row) => Number(row.amount ?? row.total_amount ?? row.total ?? 0);
const ref = (row) => String(row.id || row.invoice_id || row.payment_id || row.service_id || row.entity_id || 'unknown');

export function reconcile(input = {}, rules = DEFAULT_RULES) {
  const services = input.services || [], invoices = input.invoices || [], payments = input.payments || [];
  const inventory = input.inventory || [], signals = [];
  const byTx = (rows, id) => rows.filter((row) => !id || tx(row) === id);
  for (const service of services) {
    if (!byTx(invoices, tx(service)).length) signals.push(signal('SERVICE_WITHOUT_INVOICE', 'medium', tx(service), [ref(service)]));
  }
  for (const payment of payments) {
    if (!byTx(invoices, tx(payment)).length) signals.push(signal('PAYMENT_WITHOUT_INVOICE', 'high', tx(payment), [ref(payment)]));
  }
  const checkedPaymentTransactions = new Set();
  for (const invoice of invoices) {
    const transactionId = tx(invoice);
    if (checkedPaymentTransactions.has(transactionId)) continue;
    checkedPaymentTransactions.add(transactionId);
    const transactionInvoices = byTx(invoices, transactionId);
    const expected = transactionInvoices.reduce((sum, row) => sum + amount(row), 0);
    const transactionPayments = byTx(payments, transactionId);
    const paid = transactionPayments.reduce((sum, row) => sum + amount(row), 0);
    if (Math.abs(expected - paid) > 0.01) signals.push(signal('INVOICE_PAYMENT_MISMATCH', 'medium', transactionId, transactionInvoices.map(ref).concat(transactionPayments.map(ref)), { expected, actual: paid }));
  }
  for (const row of inventory) {
    const expected = Number(row.expected ?? (Number(row.purchased || 0) - Number(row.consumed || 0) - Number(row.returned || 0)));
    const actual = Number(row.actual ?? row.quantity ?? 0);
    if (Math.abs(expected - actual) > 0.0001) signals.push(signal('INVENTORY_PRODUCTION_VARIANCE', 'medium', tx(row), [ref(row)], { expected, actual }));
  }
  const seen = new Map();
  for (const invoice of invoices) {
    const key = [invoice.organization_id || input.organization_id || '', invoice.invoice_number || '', amount(invoice), invoice.issue_date || ''].join('|');
    if (seen.has(key)) signals.push(signal('DUPLICATE_INVOICE', 'high', tx(invoice), [seen.get(key), ref(invoice)])); else seen.set(key, ref(invoice));
  }
  return { rules, signals, counts: { services: services.length, invoices: invoices.length, payments: payments.length, inventory: inventory.length, signals: signals.length } };
}

function signal(rule_id, severity, transaction_id, evidence, details = {}) {
  return { signal_id: `SIG-${randomUUID()}`, rule_id, transaction_id: transaction_id || null, severity, confidence: 0.98, status: 'open', evidence, details, created_at: new Date().toISOString() };
}

export function scoreRisk(signals = [], weights = {}) {
  const components = { transaction_inconsistency: 0, invoice_anomalies: 0, payment_mismatch: 0, inventory_mismatch: 0, historical_pattern: 0, network_anomaly: 0 };
  for (const item of signals) {
    const score = severityWeight[item.severity] ?? 20;
    if (item.rule_id === 'SERVICE_WITHOUT_INVOICE') components.transaction_inconsistency = Math.max(components.transaction_inconsistency, score);
    if (item.rule_id === 'DUPLICATE_INVOICE') components.invoice_anomalies = Math.max(components.invoice_anomalies, score);
    if (item.rule_id.includes('PAYMENT')) components.payment_mismatch = Math.max(components.payment_mismatch, score);
    if (item.rule_id.includes('INVENTORY')) components.inventory_mismatch = Math.max(components.inventory_mismatch, score);
  }
  const policy = { transaction_inconsistency: .25, invoice_anomalies: .20, payment_mismatch: .20, inventory_mismatch: .20, historical_pattern: .10, network_anomaly: .05, ...weights };
  const total = Math.min(100, Math.round(Object.entries(components).reduce((sum, [key, value]) => sum + value * (policy[key] || 0), 0)));
  const band = total >= 75 ? 'enhanced_review' : total >= 50 ? 'priority_review' : total >= 25 ? 'review' : 'routine';
  return { score: total, band, components, policy, reason: signals.map((item) => item.rule_id) };
}

export function transitionCase(current, next) {
  if (!transitions[current]?.includes(next)) throw new Error(`Invalid governance transition ${current} -> ${next}.`);
  return { from: current, to: next, changed_at: new Date().toISOString() };
}

export function riskForRule(rule) { return severityWeight[rule?.severity] ?? 20; }
