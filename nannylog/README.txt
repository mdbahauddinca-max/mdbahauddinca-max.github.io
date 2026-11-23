NANNY LOG  v2.0  -  iPhone web app (PWA)
=========================================
Live at: https://mdbahauddinca-max.github.io/nannylog/
Parent page: parent.html (opened from the link the nanny sends)

WHAT'S IN IT
Log      - quick buttons (meal, bottle, nap, diaper, potty, activity, outing, school,
           medicine, mood, incident, photo, note), voice notes, timeline per child
Timers   - live nap timer and feeding timer; stopping them writes the log entry
Bottle   - "next bottle due" banner per child (set in More > Children > Bottle reminder)
Voice    - speak in English or Bangla; "Translate to English" button for Bangla notes
Plan     - Routines (morning / after school / bedtime checklists per child, editable)
           Calendar (school, classes, appointments; repeat weekly/weekdays; reminder;
           "Add to iPhone Calendar" so the phone alerts even when the app is closed)
           Shopping list ("running low" quick buttons, send list to parents)
Report   - daily text report to share; WEEKLY PDF report; search
Hours    - clock in/out, weekly hours, overtime after 44 h, TIMESHEET PDF for pay
More     - emergency numbers + allergies, MEDICINE PERMISSION FORMS signed on screen
           by the parent (with PDF copy), share with parents, settings, backup

INSTALL ON THE IPHONE
1. Open https://mdbahauddinca-max.github.io/nannylog/ in SAFARI.
2. Share button > Add to Home Screen > Add.
3. Open "Nanny Log" from the home screen. Add children in More > Children.
   (If v1 was already installed it updates itself the next time it opens online.)

SHARE WITH PARENTS
A) Quick link (no setup): More > Share with parents > Quick link > Send today's link.
   The link contains that day's log. It does not update; send a new one when needed.
B) Live link (one-time setup, free, about 10 minutes):
   1. Go to https://console.firebase.google.com and sign in with a Google account.
   2. "Create a project" (any name, Google Analytics not needed).
   3. Left menu: Build > Realtime Database > Create Database. Choose a location
      (e.g. us-central1), start in "locked mode".
   4. Open the "Rules" tab, replace everything with the rules below and Publish:
        {
          "rules": {
            ".read": false,
            ".write": false,
            "families": {
              "$code": {
                ".read": "$code.length >= 16",
                ".write": "$code.length >= 16"
              }
            }
          }
        }
   5. Copy the database URL shown on the "Data" tab, e.g.
      https://your-project-default-rtdb.firebaseio.com
   6. In the app: More > Share with parents > Live link. Paste the URL,
      Live sharing = On, "Save and test". When it says Connected, tap
      "Send link to parents". Parents open it in Safari (and can Add to Home Screen).
   Security: the long random family code in the link is the key. Anyone with the
   link can read the log, so only send it to the parents. "New" makes a new code
   and the old link stops working. Only text is uploaded, never photos or audio.

TRANSLATION
- Bangla notes are translated with the free MyMemory online service (limited daily
  amount). Turn it off in More > Settings if the family prefers no online service.
  You can always edit the English text before saving.

VOICE TO TEXT
- If live voice-to-text does not start in the home-screen app, tap in the text box
  and use the microphone key on the iPhone keyboard (works in English and Bangla).

REMINDERS
- Bottle-due and calendar alerts show while the app is open. For alerts when the app
  is closed, use "Add to iPhone Calendar" on the event.

KEEP THE DATA SAFE
- Data lives on this iPhone. Deleting the app or clearing Safari data deletes it.
- Every week: More > Download backup, save to Files / iCloud Drive.

PRIVACY
- Agree with the parents on what is recorded. Do not post log content or photos.
