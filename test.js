import bcrypt from "bcrypt";
import {db} from './config/firebaseAdmin.js';
import {Admin} from './tableDeclarations.js'

async function seedAdmins() {
  const rawAdminsData = [
    {
      "uid": "usr_a_94827361",
      "firstname": "Dr. Sarah",
      "lastname": "Jenkins",
      "organizationName": "Lincoln State University",
      "email": "s.jenkins@lincolnstate.edu",
      "password": "SecurePasswordA1!",
      "adminType": "school_admin_a",
      "schoolAdminsBLevelAdded": [
        "usr_b_11223344",
        "usr_b_55667788",
        "usr_b_99001122"
      ],
      "invitedBy": "sup_admin_001",
      "profilePic": ["https://example.com/profiles/s-jenkins.jpg"],
      "providerId": "password",
      "country": "United States",
      "isVerified": true,
      "lastAccessed": new Date("2026-10-29T20:48:00.000Z"),
      "sessions": [],
      "createdAt": new Date("2026-10-01T10:00:00.000Z"),
      "schoolCode": "LSU-2026"
    },
    {
      "uid": "usr_b_11223344",
      "firstname": "Marcus",
      "lastname": "Wright",
      "organizationName": "Lincoln State University",
      "email": "m.wright@lincolnstate.edu",
      "password": "SecurePasswordB1!",
      "adminType": "school_admin_b",
      "department": "Computer Science",
      "invitedBy": "usr_a_94827361",
      "profilePic": [],
      "providerId": "password",
      "country": "United States",
      "isVerified": true,
      "lastAccessed": new Date("2026-10-28T14:30:00.000Z"),
      "sessions": [],
      "createdAt": new Date("2026-10-02T11:15:00.000Z"),
      "schoolCode": "LSU-2026"
    },
    {
      "uid": "usr_b_55667788",
      "firstname": "Elena",
      "lastname": "Rodriguez",
      "organizationName": "Lincoln State University",
      "email": "e.rodriguez@lincolnstate.edu",
      "password": "SecurePasswordB2!",
      "adminType": "school_admin_b",
      "department": "Mechanical Engineering",
      "invitedBy": "usr_a_94827361",
      "profilePic": ["https://example.com/profiles/e-rodriguez.jpg"],
      "providerId": "password",
      "country": "United States",
      "isVerified": true,
      "lastAccessed": new Date("2026-10-29T09:45:00.000Z"),
      "sessions": [],
      "createdAt": new Date("2026-10-02T11:20:00.000Z"),
      "schoolCode": "LSU-2026"
    },
    {
      "uid": "usr_b_99001122",
      "firstname": "James",
      "lastname": "Chen",
      "organizationName": "Lincoln State University",
      "email": "j.chen@lincolnstate.edu",
      "password": "SecurePasswordB3!",
      "adminType": "school_admin_b",
      "department": "Business Administration",
      "invitedBy": "usr_a_94827361",
      "profilePic": [],
      "providerId": "password",
      "country": "United States",
      "isVerified": false,
      "lastAccessed": new Date("2026-10-02T11:25:00.000Z"),
      "sessions": [],
      "createdAt": new Date("2026-10-02T11:25:00.000Z"),
      "schoolCode": "LSU-2026"
    }
  ];

  try {
    const batch = db.batch();

    for (const admin of rawAdminsData) {
      // Hash the password securely
      const hashedPassword = await bcrypt.hash(admin.password, 10);

      // Use the admin's 'uid' as the document ID in Firestore
      const docRef = Admin.doc(admin.uid);

      batch.set(docRef, {
        ...admin,
        password: hashedPassword
      });
    }

    // Commit the batch operation to Firestore
    await batch.commit();
    console.log("Success! Seeded all 4 admin documents into Firestore.");
  } catch (error) {
    console.error("Failed to seed admin collection:", error);
  }
}
seedAdmins();