import bcrypt from "bcrypt";
import {db} from './config/firebaseAdmin.js';
import {Admin} from './tableDeclarations.js'

async function seedAdmins() {
  const rawAdminsData = [
    {
      uid: "adm_audit_94827361",
      firstname: "Dr. Philip",
      lastname: "Morgan",
      organizationName: "Morgan Accounting and Audit Ltd",
      email: "audit@morganaccounting.io",
      password: "morganTheAuditor001",
      adminType: "finance",
      invitedBy: "sup_admin_001",
      profilePic: [
        "https://res.cloudinary.com/dbdw3zftx/image/upload/v1769094810/startimage3_qolym4.jpg",
      ],
      providerId: "password",
      country: "Nigeria",
      isVerified: true,
      lastAccessed: new Date("2026-10-29T20:48:00.000Z"),
      sessions: [],
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
    },
    {
      uid: "adm_support_11223344",
      firstname: "Julius",
      lastname: "Werner",
      organizationName: "iCampus Technologies Ltd",
      email: "juliuswerner20@gmail.com",
      password: "supportStaffiCampus01",
      adminType: "support",
      invitedBy: "sup_admin_001",
      profilePic: [
        "https://res.cloudinary.com/dbdw3zftx/image/upload/v1749840221/uploads/para%20el%202024%20se%20viene%20este%20futuro.jpg",
      ],
      providerId: "password",
      country: "Nigeria",
      isVerified: true,
      lastAccessed: new Date("2026-10-28T14:30:00.000Z"),
      sessions: [],
      createdAt: new Date("2026-10-02T11:15:00.000Z"),
    },
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