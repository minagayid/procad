# Sparse dental reconstruction research

This experiment estimates the external shape of a single tooth from two calibrated periapical-style projections, with a third straight projection as an optional input. Inputs are compared with a straight-only baseline and a mean training-mask baseline. The result is a tooth occupancy volume and an OBJ surface mesh. No CT attenuation volume, canal segmentation, diagnosis, treatment-planning validation, or acquisition protocol is provided.

## ProCAD tooth atlas and landmarks

```bash
bash scripts/import_bodyparts3d.sh
python research/sparse_dental/atlas.py build /path/to/atlas-export
```

The atlas builder verifies ProCAD's pinned GLB and extracts the 28 mapped permanent-tooth meshes. It groups triangles into mesial, distal, facial (labial or buccal), oral (palatal or lingual), coronal (incisal or occlusal), and apical regions using their local position and surface normals. These are geometric approximations. The upstream atlas lacks third molars (18, 28, 38, 48), primary teeth, and internal tissue labels. The atlas inherits upstream-declared scale and uses a tooth-local coordinate frame with axes pointing mesially, facially, and coronally.

```bash
python research/sparse_dental/atlas.py fit landmark-job.json /path/to/atlas-fit
```

In the JSON job, set `fdi` to the permanent tooth number. Under `views`, use `mesial_shift`, `distal_shift`, and optionally `straight`. For each view, provide a calibrated 3×4 projective camera `matrix` mapping local millimetres to pixels and a `landmarks` object that maps names from the atlas manifest to corresponding pixel coordinates `[column, row]`. Calibration must use the same coordinate system and detector pixel convention across views. At least four noncoplanar corresponding landmarks must each appear in at least two views. The fitter estimates a rotation, translation, and uniform scale, checks the reprojection error, and writes an OBJ and the observed pixel residual. Geometrically selected atlas points require an expert to establish correspondence on actual films. The fit estimates pose and scale while preserving the individual's atlas template shape. BodyParts3D geometry is neither a model input nor part of checkpoint training.

## ToothFairy2 preparation and GPU training

Download the small subset with matching images, labels, and dataset metadata from [Ditto](https://ditto.ing.unimore.it/toothfairy2/). Use the dataset directory containing `imagesTr`, `labelsTr`, and `dataset.json`. The reader accepts the nnU-Net single-channel `_0000` convention for MHA or NIfTI images and matching integer labels. A split needs at least three usable independent groups. Use a `--patient-groups` JSON mapping, keyed by scan identifier, when multiple scans come from one patient. Without that mapping, holdouts are case-disjoint only. Keep input and prepared crops private and outside the source tree.

```bash
python -m pip install -r research/sparse_dental/requirements.txt
python research/sparse_dental/prepare.py --toothfairy2 /private/ToothFairy2 --output /private/prepared
python research/sparse_dental/reconstruct.py train /private/prepared /private/checkpoint --device cuda
```

The simulator resamples each tooth region in physical coordinates, using CBCT labels to localize and orient crops. It traces rays through approximate attenuation at simulated mesial shift, straight, and distal shift poses. Default 20° shifts are simulator parameters. The crop supplies finite surrounding context. CBCT voxel values are treated as approximate attenuation. The projector does not simulate scatter, exposure response, detector noise, the full dental arch, or patient motion. Crop localization uses reference labels and therefore overestimates the information available in a real radiograph workflow.

The model backprojects each available view into the tooth-local grid and learns to refine a centered ellipsoid using camera evidence and voxel coordinates. The ellipsoid is the same heuristic used for the initialization baseline. It reports Dice, IoU, average symmetric surface distance, 95th-percentile Hausdorff distance, empty predictions, and support by FDI. Distance summaries exclude empty predictions and list their count. Evaluate patient or case holdouts before any release. There is no paired real-radiograph validation. The experiment measures the added value of simulated views for a shape estimate and cannot establish diagnostic equivalence to CBCT.

To run a procedural smoke test without the dataset:

```bash
python research/sparse_dental/prepare.py --synthetic 64 --size 24 --pixels 40 --output /tmp/procad-prepared
python research/sparse_dental/reconstruct.py train /tmp/procad-prepared /tmp/procad-checkpoint --device cuda --epochs 12
```

## Inference

```bash
python research/sparse_dental/reconstruct.py infer /private/checkpoint projection-job.json /private/estimate
```

The job has the same `fdi`, `views`, and per-view `matrix` keys as above. For each view add an `image` path pointing to a detector-size 2D NumPy array of finite, nonnegative, calibrated line integrals at the training scale. Use the paired shifts or all three views. Landmark marks are inputs to the separate atlas registration command. This path requires external crop localization, view calibration, and intensity calibration to prepare real-image inputs. The exported soft occupancy values are not calibrated confidence scores. An absent tooth class in checkpoint training is explicitly rejected.

## Attribution and release

- The atlas is BodyParts3D / Anatomography, © The Database Center for Life Science (DBCLS), adapted by OrganUI. Its transformed OBJ meshes remain under [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en). Keep the provenance manifest with exports. [ProCAD atlas attribution](../../app/public/dental-library/bodyparts3d-teeth-4.3/ATTRIBUTION.md)
- ToothFairy2 is from AImageLab at the University of Modena and Reggio Emilia and Radboud University. As clarified by the dataset maintainer, its images, labels, derived projections, and research checkpoint are governed by [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Commercial use is prohibited. The older license field in some copies of `dataset.json` is erroneous. Release the model card, weights, config, and aggregate tests only. Attribute ToothFairy2 and cite all three works listed by the challenge. [ToothFairy2 challenge dataset and citations](https://toothfairy2.grand-challenge.org/dataset/)

### Private Kaggle runner

With the explicitly authorized small Ditto archive attached as a private
notebook input and a GPU selected, clone this branch into a working directory.
Install the missing dependencies while retaining Kaggle's CUDA-enabled PyTorch.
Run the following command with the actual input path. The runner unpacks and
prepares data in a temporary directory, then copies only the checkpoint,
configuration, aggregate metrics and draft model card into the output.

```bash
python research/sparse_dental/kaggle_run.py \
  --archive /kaggle/input/PRIVATE-DATASET/ToothFairy2_Dataset_v02_Samples.zip \
  --output /kaggle/working/procad-toothfairy2-checkpoint
```

Inspect the metrics, class support and licensing metadata before posting that
folder to Hugging Face.
