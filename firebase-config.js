// ─────────────────────────────────────────────────────────────────────────────
// firebase-config.js — Firebase initialisation
// ─────────────────────────────────────────────────────────────────────────────
//
// SETUP INSTRUCTIONS (one-time):
//
//  1. Go to https://console.firebase.google.com/
//  2. Create a new project (or open an existing one).
//  3. Click "Add app" → choose the Web ( </> ) platform.
//  4. Register the app (you can skip Firebase Hosting setup).
//  5. Firebase will show you a config object that looks like the one below.
//  6. Copy each value and paste it in the matching field below.
//  7. In the Firebase console, open Firestore Database and create a database
//     (start in production mode — you'll add rules in step 8).
//  8. Go to Firestore → Rules and paste the security rules shown further below.
//
// ─────────────────────────────────────────────────────────────────────────────
//
// RECOMMENDED FIRESTORE SECURITY RULES:
//
//   These rules let anyone submit an order but prevent public listing or
//   reading of orders (only you can read them via the Firebase console).
//   Paste this into Firestore → Rules → Edit rules:
//
//   ┌─────────────────────────────────────────────────────────────────────┐
//   │  rules_version = '2';                                               │
//   │  service cloud.firestore {                                          │
//   │    match /databases/{database}/documents {                          │
//   │      match /orders/{orderId} {                                      │
//   │        // Anyone can submit a new order (create only)               │
//   │        allow create: if true;                                       │
//   │        // No public read, update, or delete                         │
//   │        allow read, update, delete: if false;                        │
//   │      }                                                              │
//   │      // Deny everything else by default                             │
//   │      match /{document=**} {                                         │
//   │        allow read, write: if false;                                 │
//   │      }                                                              │
//   │    }                                                                │
//   │  }                                                                  │
//   └─────────────────────────────────────────────────────────────────────┘
//
// ─────────────────────────────────────────────────────────────────────────────
//
// FIRESTORE COLLECTION STRUCTURE  (auto-created on first order submission):
//
//   orders/                        ← collection
//     {auto-id}/                   ← document (one per order)
//       customerName  : string     — customer's full name
//       phone         : string     — contact phone number
//       email         : string | null
//       area          : string | null  — preferred pickup/delivery area
//       preferredTime : string | null  — preferred date/time note
//       notesToOwner  : string | null  — custom instructions
//       items         : array      — cart snapshot (see below)
//         [{ id, name, category, price, qty, subtotal }]
//       total         : number     — order total in dollars
//       status        : "new"      — updated manually by you later
//       createdAt     : Timestamp  — server-side timestamp
//
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ⬇️  REPLACE every "YOUR_…" value with your actual Firebase project config.
//     Do NOT leave placeholder strings in production — orders will fail silently.

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);

// `db` is exported and used in app.js to save orders.
export const db = getFirestore(app);
