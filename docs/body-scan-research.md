# Phone body measurement: research notes and design

Goal: a page that runs in a phone browser, uses the camera, and returns body measurements in centimetres. This note summarises recent work on phone photogrammetry, Gaussian splats and metric body capture (searched November 2026), and explains why the scanner is built the way it is.

## What recent work shows

**Smartphone anthropometry is useful but still being validated.** A systematic review of smartphone and tablet 3D/4D scanning for anthropometry calls for better algorithms and standard protocols before the results are treated as equivalent to tape measures ([PMC review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12797699)). A University of Antwerp study compared two phone apps, 3D Measure Me and MeThreeSixty, with tape, stadiometer and 4D stereophotogrammetry in 35 adults. It is registered as completed in February 2026, but no results were posted when I checked ([NCT07589998](https://clinicaltrials.gov/study/NCT07589998)). Smaller 2025 studies report phone apps as feasible for apparel sizing ([ITAA 2025](https://www.iastatedigitalpress.com/itaa/article/id/21680/)).

**Front and side silhouettes plus height are the standard learned baseline.** Amazon's BodyM dataset pairs 8,978 frontal and lateral silhouettes from 2,505 people with height, weight and 14 tape measurements. These include girths of the chest, waist, hip, thigh, calf, bicep, forearm, wrist and ankle, plus shoulder breadth and shoulder-to-crotch length. Its harder test split was captured with varied camera orientations and lighting. The dataset is licensed CC BY-NC 4.0 ([paper](https://arxiv.org/abs/2210.05667), [registry](https://registry.opendata.aws/bodym/)). The scanner reports the same set of measurements, so a learned regressor trained on BodyM could later be swapped in.

**Single-image body models are robust but regress toward the mean.** Meta's SAM 3D Body (CVPR 2026) recovers a full-body mesh from one image using the Momentum Human Rig ([CVPR](https://cvpr.thecvf.com/virtual/2026/poster/37714)). An early critique finds that it misses individual shape deviations such as pregnancy, scoliosis and atrophy, tending toward a population mean. The authors judge it unsuited to diagnostic reconstruction, though their evaluation is qualitative ([arXiv 2601.06035](https://arxiv.org/abs/2601.06035)). A body-model prior is good for pose. It is risky as the source of the girth itself.

**Gaussian splatting for humans has reached phones, but for rendering, not measuring.** HRM²Avatar (SIGGRAPH Asia 2025) builds avatars from monocular phone scans: one static sequence for texture and one moving sequence for deformation, with Gaussians attached to the surface of a mesh. It renders at 120 FPS on mobile devices. It reports no geometric accuracy ([arXiv 2510.13587](https://arxiv.org/abs/2510.13587)). GaussianAvatar anchors Gaussians to SMPL from monocular video ([Computers & Graphics](https://www.sciencedirect.com/science/article/abs/pii/S0097849324002905)). FMGS-Avatar uses mesh-guided 2D Gaussians with foundation-model priors ([arXiv 2509.14739](https://arxiv.org/abs/2509.14739)). Training still happens offline on a GPU. Splats are also not a closed surface, so measuring one requires extracting a mesh or a body-model fit first.

**Metric scale needs an external anchor.** Monocular structure-from-motion and feed-forward point-map models such as MASt3R produce geometry with an unknown scale. Metric results come from depth sensors or added metric priors. For example, GTLR-GS supervises Gaussian splats with LiDAR depth and down-weights its noise at depth edges ([arXiv 2603.23192](https://arxiv.org/abs/2603.23192)). In a browser, LiDAR and ARKit are unavailable. WebXR depth sensing is a separate module with uneven device support; Android XR Chrome lists it, and Safari has no WebXR, so it must be feature-detected ([Android XR web docs](https://developer.android.com/develop/xr/web)). The practical anchors are a **known height** (used here) or a reference object of known size.

## Design decisions

| Decision | Why |
| --- | --- |
| On-device MediaPipe Pose Landmarker (33 landmarks + person mask), self-hosted | Runs in any modern phone browser with WebAssembly and WebGL. No frames leave the device. It works under a strict `'self'` CSP. |
| Metric scale from the user's height | It is the anchor used by commercial apps and BodyM. It needs no extra hardware and works on iOS Safari. The mask's head-to-heel span equals the stated height, which gives cm/px at the body plane. |
| Levels from landmarks, widths from the mask | Landmarks are good at *where* a measurement goes but poor at *how wide* the body is. The silhouette is accurate there. Sub-pixel edges come from the soft mask. |
| Heights, not pixel rows, link the views | Each view keeps its own scale, so a profile photo taken from a different distance still lines up with the front. |
| **Turn-in-place girths via Cauchy's formula** | A tape follows the convex outline. The perimeter of a convex cross-section is the integral of its caliper width over half a turn, P = ∫₀^π w(θ) dθ. The phone stays fixed while the subject turns with arms raised in a V, so the torso is never hidden. Each frame gives w(θ) at the chest, waist and hip levels. Body symmetry folds θ into 0–90°. The angle comes from the 2D shoulder and hip spans (|cos θ|) rather than MediaPipe's noisy monocular depth. This makes no ellipse assumption: on a rounded-rectangle section the two-view ellipse is more than 3% off, while the turntable estimate is within 0.5% (see the unit tests). |
| Two-view ellipse as the fallback | Front width plus profile depth with Ramanujan's perimeter. It is exact for elliptical sections. |
| Off-profile leg correction | Near profile, the two legs no longer line up. The union is deeper by 2·L·|cos θ|, which is subtracted. |
| Plausibility gates | Chords that run away, sites outside adult width/height ranges, an implausible inseam, and bent arms are all dropped with a reason. A merged silhouette, such as a second person, is rejected rather than measured. |
| Splat export instead of in-browser splatting | The turn frames, person masks, landmarks and scale are exported as a zip. Offline COLMAP/GLOMAP or MASt3R/VGGT, then gsplat or nerfstudio, can reconstruct them. Height or cm/px restores metric scale. |

## Accuracy, honestly

On the synthetic body (exact ground truth, orthographic camera, perfect mask), every torso and leg girth is within 0.5% and lengths are within 0.5 cm. That checks the geometry, not the real world. Real error is dominated by the following:

- **Clothing and hair:** the mask follows fabric.
- **Segmentation edges:** about 1–2 px. At 3 m from a 1080p portrait camera that is roughly 0.2–0.4 cm per edge.
- **Posture:** the waist level, breathing and arm angle all move the result.
- **Perspective and tilt:** keep the phone upright at waist height and 2.5–3 m away. The app shows a level check.
- **Height:** its error scales every measurement.

The ± shown per measurement is a design estimate per method (turntable 2.5%, two-view 4%, circular limbs 7%, front-only 10%), not a validated figure.

Validating against tape on real people is the next step. The Antwerp protocol (tape, stadiometer and a stereophotogrammetry reference) is a good template.

## Next steps

1. Run a validation study against tape on 20–30 people, reporting the mean absolute error and limits of agreement per site.
2. Fit a body model (SMPL-X or MHR) to the silhouettes from every turn frame, so that the measurements come from a watertight mesh constrained by many views.
3. Add a reference-object scale: an ID-1 card (85.60 × 53.98 mm) or A4 sheet held at the body plane, as an alternative to height.
4. Use WebXR depth sensing where it is available (Android) for metric scale without entering a height.
5. Train a BodyM-style regressor on the silhouettes as a second opinion. It cannot be used commercially as-is because of the dataset licence.
