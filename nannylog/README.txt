NANNY LOG  v1.0  -  iPhone web app (PWA)
=========================================

What it does
- Daily log with quick buttons: meal, snack, bottle, nap, diaper, potty, activity,
  outing, school, medicine, mood, incident, photo, note
- Voice note: speak, it becomes text you can edit, then save (optional audio kept too)
- Separate entries per child; filter by child
- Daily report for parents: one tap to share by Messages, WhatsApp or email
- Search across all days
- Hours: Clock in / Clock out, weekly hours, overtime after 44 h, pay estimate
- Emergency card: 911, Ontario Poison Centre, Health811, parent phone, allergies
- Backup / restore (JSON) and spreadsheet export (CSV)
- Works offline. All data stays on the phone. No account, no server.

HOW TO PUT IT ON THE IPHONE (one time, about 10 minutes)
1. The app must be on an https:// web address. Easiest free option is GitHub Pages:
   a. Go to github.com, create a new public repository, e.g. "nannylog".
   b. Click "Add file" > "Upload files" and upload EVERYTHING in this folder
      (index.html, manifest.json, sw.js, README.txt and the icons folder).
   c. Settings > Pages > Source: "Deploy from a branch", Branch: main, folder: / (root) > Save.
   d. After a minute the address will be  https://YOUR-USERNAME.github.io/nannylog/
   (Netlify Drop or Cloudflare Pages also work: just drag the folder in.)
2. On the iPhone, open that address in SAFARI (not Chrome).
3. Tap the Share button > "Add to Home Screen" > Add.
4. Open "Nanny Log" from the home screen. It now runs full screen like an app.

FIRST-TIME SETUP IN THE APP
- More > Children: add each child (name, age, allergies).
- More > Settings: her name, parent name, parent phone, hourly rate, voice language.

VOICE TO TEXT - IMPORTANT
- Tap "Voice note" then the red mic. Allow microphone/speech when iPhone asks.
- If live voice-to-text does not start (this can happen in home-screen apps on some
  iOS versions), tap inside the text box and use the microphone key on the iPhone
  keyboard. iPhone dictation works everywhere, on-device, in English or Bangla
  (Settings > General > Keyboard > Enable Dictation; add the Bangla keyboard for Bangla).
- Voice language can be changed in More > Settings.

KEEP THE DATA SAFE
- Data lives only on this iPhone, inside the app. If the app is deleted from the
  home screen, or Safari website data is cleared, the log is deleted too.
- Every week: More > Download backup, then save the file to Files / iCloud Drive.
- To move to a new phone: install the app there, then More > Restore from backup.

UPDATING THE APP LATER
- Upload the new files to the same GitHub repository. The app updates the next time
  it is opened with internet.

PRIVACY
- Entries can include children's names, photos and health notes. Agree with the
  parents on what is recorded, and do not post log content or photos anywhere.
