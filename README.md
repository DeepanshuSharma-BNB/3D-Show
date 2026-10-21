# 3D Show

**CAD in your view.** Pair Meta Ray-Ban Display glasses with a computer or phone browser, import STEP CAD files, and inspect or arrange objects using Neural Band wrist orientation.

**Public website:** https://deepanshusharma-bnb.github.io/3D-Show/

**Glasses:** https://deepanshusharma-bnb.github.io/3D-Show/?view=glasses

**Upload Studio:** https://deepanshusharma-bnb.github.io/3D-Show/?view=studio

## Quick start

1. Register the **glasses** URL as a Web App in Meta AI > App connections.
2. Open the **Studio** URL in a browser on your laptop or phone.
3. Enter the **15-character pairing key** shown in your glasses. Keep both pages open.
4. Use **Sample objects** to test the connection, or import a STEP/STP file.
5. Select **Send collection to glasses** and allow time to transfer the model.
6. Use your Neural Band to browse, inspect, zoom, and arrange one, two, or three models.

## Controls

- Wrist rotation: orbit around the scene. In Arrange mode, move the selected component.
- Swipe left/right: next/previous model. In Arrange mode with two or three objects, select a component instead.
- Swipe up/down: zoom in/out.
- Pinch/Enter: switch between Orbit and Arrange modes.
- On-screen MODE button: Solo, Duo or Trio; WRIST button enables orientation; recenter button resets wrist reference.
- **New precision controls:** Tap ⚙ (or focus it with the Neural Band) to configure Precision vs Free 3D, sensitivity 0.50–2.00×, reversed axes, and the horizontal turning input (Yaw, Wrist twist, Balanced). Recenter in a comfortable wrist position after changes. Settings stay in the glasses browser's local storage.
- **Precision mode** separates horizontal yaw from vertical tilt and suppresses tiny tremors. **Free 3D** applies neutral-relative quaternion orientation including roll, rather than decomposing it into two Euler angles.
- Hold your wrist steady briefly after enabling tracking or recentering to establish a stable neutral reference.
- Phone/desktop: drag to orbit, scroll to zoom, select objects via the model list.

## Architecture

- Public static site: GitHub Pages.
- Three.js for WebGL rendering.
- OpenCascade through occt-import-js (WASM) in the uploading phone/desktop browser. Optimized triangle meshes, not STEP source, are sent onward.
- Cross-device pairing: 15-character random code, an encrypted temporary MQTT-over-WebSocket room on a public broker, and chunked transfer.
- AES-GCM encrypts the payload before publication. The broker sees the hashed room name, packet sizes, timing and IP metadata, not unencrypted model data.
- Browser-side model library: IndexedDB stores optimized models on the same phone/computer browser; images and STEP originals are not uploaded.
- Glasses-side model memory: temporary for the active session. No permanent cloud CAD storage.

## Security and caveats

This is a first experimental version. Public brokers (EMQX and Mosquitto) are third-party best-effort infrastructure and might be unavailable, rate-limited, or blocked from the glasses. Pairing and upload end-to-end require testing on actual glasses. The service is not a certified CAD collaboration environment. **Do not import confidential CAD, patent-sensitive designs or regulated designs without a private relay and independent security assessment.**

Source geometry is tessellated and sampled to fit small wearable displays. The resulting rendering is intended for visual inspection, not precision manufacturing, accurate dimensioning or editing original STEP solids.

External browser dependencies require network access. A public URL cannot guarantee that a given glasses firmware supports every WebGL or WASM capability.

## Local testing

Run python3 -m http.server 8000 in the repository folder, then visit localhost:8000/?view=studio and localhost:8000/?view=glasses in separate tabs. To test across devices use the deployed HTTPS GitHub Pages URLs.

Run npm test and npm run check to validate pairing helpers and syntax.

Deployment uses GitHub Actions on pushes to main.
