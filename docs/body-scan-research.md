# Phone body measurement: research notes and design

Goal: a page that runs in a phone browser, uses the camera, and returns body measurements in centimetres. This note summarises recent work on phone photogrammetry, Gaussian splats and metric body capture (searched November 2026), and explains why the scanner is built the way it is.

## What recent work shows

**Smartphone anthropometry is useful but still being validated.** A systematic review of smartphone and tablet 3D/4D scanning for anthropometry calls for better algorithms and standard protocols before the results are treated as equivalent to tape measures ([PMC review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12797699)). A University of Antwerp study compared two phone apps, 3D Measure Me and MeThreeSixty, with tape, stadiometer and 4D stereophotogrammetry in 35 adults. It is registered as completed in February 2026, but no results were posted when I checked ([NCT07589998](https://clinicaltrials.gov/study/NCT07589998)). Smaller 2025 studies report phone apps as feasible for apparel sizing ([ITAA 2025](https://www.iastatedigitalpress.com/itaa/article/id/21680/)).

**Front and side silhouettes plus height are the standard learned baseline.** Amazon's BodyM dataset pairs 8,978 frontal and lateral silhouettes from 2,505 people with height, weight and 14 tape measurements. These include girths of the chest, waist, hip, thigh, calf, bicep, forearm, wrist and ankle, plus shoulder breadth and shoulder-to-crotch length. Its harder test split was captured with varied camera orientations and lighting. The dataset is licensed CC BY-NC 4.0 ([paper](https://arxiv.org/abs/2210.05667), [registry](https://registry.opendata.aws/bodym/)). The scanner reports the same set of measurements, so a learned regressor trained on BodyM could later be swapped in.

**Single-image body models are robust but regress toward the mean.** Meta's SAM 3D Body (CVPR 2026) recovers a full-body mesh from one image using the Momentum Human Rig ([CVPR](https://cvpr.thecvf.com/virtual/2026/poster/37714)). An early critique finds that it misses individual shape deviations such as pregnancy, scoliosis and atrophy, tending toward a population mean. The authors judge it unsuited to diagnostic reconstruction, though their evaluation is qualitative ([arXiv 2601.06035](https://arxiv.org/abs/2601.06035)). A body-model prior is good for pose. It is risky as the source of the girth itself.

**Gaussian splatting for humans has reached phones, but for rendering, not measuring.** HRM²Avatar (SIGGRAPH Asia 2025) builds avatars from monocular phone scans: one static sequence for texture and one moving sequence for deformation, with Gaussians attached to the surface of a mesh. It renders at 120 FPS on mobile devices. It reports no geometric accuracy ([arXiv 2510.13587](https://arxiv.org/abs/2510.13587)). GaussianAvatar anchors Gaussians to SMPL from monocular video ([Computers & Graphics](https://www.sciencedirect.com/science/article/abs/pii/S0097849324002905)). FMGS-Avatar uses mesh-guided 2D Gaussians with foundation-model priors ([arXiv 2509.14739](https://arxiv.org/abs/2509.14739)). Training still happens offline on a GPU. Splats are also not a closed surface, so measuring one requires extracting a mesh or a body-model fit first.

**Metric scale needs an external anchor.** Monocular structure-from-motion and feed-forward point-map models such as MASt3R produce geometry with an unknown scale. Metric results come from depth sensors or added metric priors. For example, GTLR-GS supervises Gaussian splats with LiDAR depth and down-weights its noise at depth edges ([arXiv 2603.23192](https://arxiv.org/abs/2603.23192)). In a browser, LiDAR and ARKit are unavailable. WebXR depth sensing is a separate module with uneven device support; Android XR Chrome lists it, and Safari has no WebXR, so it must be feature-detected ([Android XR web docs](https://developer.android.com/develop/xr/web)). The practical anchors are a **known height** (used here) or a reference object of known size.

**Metric camera motion from a phone video.** NVIDIA's [MetricTrail](https://huggingface.co/nvidia/MetricTrail) (model card dated 11/05/2026) estimates camera trajectories and per-frame metric depth from long monocular RGB sequences. It combines a frozen single-image metric-depth model (MoGe-2), DPVO sparse patch correspondences with a frozen DINOv3 encoder, and local bundle adjustment, with supplied or self-estimated intrinsics. Its reported results include:

- 7Scenes (indoor): 6.3–6.7 cm trajectory error.
- TUM RGB-D: 4.4–8.4 cm.
- Wild-SLAM MoCap: 1.65–2.70 cm.

Its limits for this app:

- It needs CUDA, and the checkpoint is "released separately".
- Its licence limits it to non-commercial research or evaluation.
- It does not handle moving objects, and its scores on dynamic scenes trail leading methods.
- It exports trajectories and depth, not meshes.

The takeaway for body scanning: **metric scale can be re-anchored every frame from a metric prior while the camera moves**. This app's prior is cheaper and stronger for its narrow task: the subject's known height plus the phone's gravity vector.

## Design decisions

| Decision | Why |
| --- | --- |
| On-device MediaPipe Pose Landmarker (33 landmarks + person mask), self-hosted | Runs in any modern phone browser with WebAssembly and WebGL. No frames leave the device. It works under a strict `'self'` CSP. |
| Metric scale from the user's height | It is the anchor used by commercial apps and BodyM. It needs no extra hardware and works on iOS Safari. The mask's head-to-heel span equals the stated height, which gives cm/px at the body plane. |
| Levels from landmarks, widths from the mask | Landmarks are good at *where* a measurement goes but poor at *how wide* the body is. The silhouette is accurate there. Sub-pixel edges come from the soft mask. |
| Heights, not pixel rows, link the views | Each view keeps its own scale, so a profile photo taken from a different distance still lines up with the front. |
| **A helper walks around (MetricTrail-style moving camera)** | The subject stands still and a helper walks a circle with the phone. Each frame is leveled from the gravity sensor, which removes pitch and roll by a pure rotation about the lens. It then gets its own metric scale and floor from the subject's height. That is the per-frame metric anchor MetricTrail gets from a depth model. From the same quantities each frame also yields where the camera was: angle (from the signed shoulder and hip spans, with the nose's offset near front and back), distance (scale × an assumed focal length) and height (floor row relative to the horizon). The heel-parallax correction follows the viewing angle, because the heels are behind the body from the front, beside it from the side, and in front of it from behind. In simulation the camera path is recovered to about 0.5° and 1 cm in height with exact masks, and about 5° and 2 cm with MediaPipe. |
| **Arms out for the whole scan** | Held straight out at shoulder height, the arms never cross the chest, waist or hip rows from any angle. In an A-pose or with arms down, they merge with the torso outline at oblique angles. The app requires the pose and does not measure frames without it. A frame is dropped only if an arm actually merges with the torso outline at that row. An arm hidden behind or in front of the torso does not count. |
| **Turn-in-place girths via Cauchy's formula** | A tape follows the convex outline. The perimeter of a convex cross-section is the integral of its caliper width over half a turn, P = ∫₀^π w(θ) dθ. The phone stays fixed while the subject turns, and each frame gives w(θ). Body symmetry folds θ into 0–90°. The angle comes from the *horizontal* 2D shoulder and hip spans (|cos θ|). Perspective tilts the vertical component as the body turns, and MediaPipe's monocular depth is noisy. This makes no ellipse assumption: on a rounded-rectangle section the two-view ellipse is more than 3% off, while the turntable estimate is within 0.5% (see the unit tests). |
| Two-view ellipse as the fallback | Front width plus profile depth with Ramanujan's perimeter. It is exact for elliptical sections. |
| Legs on the turntable | Wherever the legs separate in the image, each leg's width is read at its own scale and row, mapped from that leg's hip, knee and ankle landmarks. One leg swings nearer the camera (larger, and lower in the image below eye level) while the other recedes. Leg depth comes from the near-profile overlap at the nearer leg's scale (its lower percentile, when the far leg is fully hidden). |
| Floor at the heels, with parallax | Toes pointing at the camera reach lower in the image than the heels: about 4% of scale at 2.5 m. The floor is taken at the heel landmarks. It is then shifted by the parallax of a heel about 3% of stature behind the body plane, assuming an upright phone with a typical 68° main-camera field of view. The front view's floor row and scale are reused for every turn frame. |
| Plausibility gates | Chords that run away, sites outside adult width/height ranges, an implausible inseam, and bent arms are all dropped with a reason. A merged silhouette, such as a second person, is rejected rather than measured. |
| Splat export instead of in-browser splatting | The turn frames, person masks, landmarks and scale are exported as a zip. Offline COLMAP/GLOMAP or MASt3R/VGGT, then gsplat or nerfstudio, can reconstruct them. Height or cm/px restores metric scale. |

## Accuracy, honestly

**Simulation in a room, with a helper walking around.** The latest results, including the furnished-room walk-around with real MediaPipe, are in the README and in `test-results/body-scan-sim/report.md` after `npm run test:sim`. In the walk-around with MediaPipe:

- Torso girths: +1% to +2%.
- Legs: −0.4% to +5%.
- Neck (front-only estimate): +12% to +27% across runs, the weakest.

The chest varies by a few percent between runs. With arms out, this body's chest girth changes about 1.7 cm per centimetre of height just below the armpits, so each walk-around frame places torso levels between its own shoulder- and hip-joint landmarks rather than using its floor line.

**Simulation with a 3D body.** The CC0 MakeHuman base mesh is posed with its CC0 skeleton and weights (arms out). A pinhole phone camera renders it, and the app scans it. Every measurement is scored against the posed mesh, sliced where the app measured and taken as the tape (convex hull) perimeter. The simulation uncovered real perspective problems that the earlier orthographic synthetic body could not:

- A floor at the toe tips gave a 4% scale error.
- A yaw estimate from 2D shoulder distance read 84° at a true 90°.
- Near and far legs image at different rows and sizes.
- With the camera high, a "widest hip" row landed below the crotch.
- With the camera low, an over-cautious arm filter dropped valid frames.

All are fixed. Errors in the current run against the mesh:

- **Exact masks and joints (geometry only), five setups.** These cover camera height 70–130 cm, distance 2.5–3 m, field of view 66–72°, and body girth ×0.85–×1.25.
  - Torso girths: within 2%.
  - Thigh, knee and calf: within 5%. Ankle: within 6%.
  - Neck: within 7%.
  - Arms (circular or ratio-based): within 10–12%.
  - Lengths: within 2.5 cm.
- **MediaPipe on rendered frames (the real app pipeline).**
  - Torso: +1.4% to +2.8%.
  - Legs: −1.5% to +5.6%.
  - Neck: +8%. Upper arm: +9%. Forearm: +14%.
  - Inseam: −3.6 cm.

  The ML mask runs slightly wide. The thresholds are deliberately not tuned to rendered data, because a mannequin is not a clothed person.

Real error will be larger than either and is dominated by the following:

- **Clothing and hair:** the mask follows fabric.
- **Segmentation edges:** MediaPipe's mask edge is soft, about 1–2 px.
- **Posture:** arm height, breathing and stance.
- **Tilt and camera height:** the parallax correction assumes an upright phone.
- **Height:** its error scales every measurement.

The ± shown per measurement is a design estimate per method (turntable 2.5%, two-view 4%, circular limbs 7%, front-only 10%), not a validated figure. Validating against tape on real people is the next step. The Antwerp protocol (tape, stadiometer and a stereophotogrammetry reference) is a good template.

## Next steps

1. Run a validation study against tape on 20–30 people, reporting the mean absolute error and limits of agreement per site.
2. Fit a body model (SMPL-X or MHR) to the silhouettes from every turn frame, so that the measurements come from a watertight mesh constrained by many views.
3. Add a reference-object scale: an ID-1 card (85.60 × 53.98 mm) or A4 sheet held at the body plane, as an alternative to height.
4. Use WebXR depth sensing where it is available (Android) for metric scale without entering a height.
5. Train a BodyM-style regressor on the silhouettes as a second opinion. It cannot be used commercially as-is because of the dataset licence.
