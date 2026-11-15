# Axiom Studia Study Panel

This Chrome or Edge extension shows the selected subject's timer, tasks, and
resources beside a normal website tab. Gizmo and other sites run as top-level
tabs in the student's existing browser profile, so their ordinary browser
sign-in can work. The extension does not read site cookies or credentials.

## Install for local use

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode** and choose **Load unpacked**.
3. Select the `browser-companion` folder from this repository.
4. Open Axiom Studia in the same browser profile and select a subject in
   Workspace. Click the **Axiom Studia Study Panel** extension icon while
   the Axiom tab is active. Pin the icon if desired.
5. Choose a saved HTTPS resource from the panel. It opens in a normal tab,
   with the study panel alongside it. Use the same browser profile in which
   you already signed in to the resource website.

Keep the Axiom tab open while studying. Its existing timer and local/cloud
workspace remain the source of truth. Reload Axiom and click the extension
icon again if the connection is lost. The panel can select a subject, start,
pause, or reset the existing timer, focus a task, mark a task complete, and
open saved links. Uploaded PDFs without a URL open in Axiom Workspace.
When a timer completes, return to Axiom to fill in the existing session log.

The extension uses `activeTab` only when the student clicks its icon on the
Axiom tab. It requests no permanent website host access. Browser side panels
are available on desktop Chromium browsers; the ordinary Subject Workspace
remains available elsewhere.
