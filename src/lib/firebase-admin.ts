import * as admin from 'firebase-admin';
import path from 'path';

// Path to your Service Account Key
// We assume it's in the backend root or configured via env
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '../../service-account.json');

let db: admin.firestore.Firestore;

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(SERVICE_ACCOUNT_PATH)
        });
        console.log('[Firebase Admin] Initialized successfully.');
    }
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
} catch (error) {
    console.error('[Firebase Admin] Initialization Failed:', error);
    // Fallback or exit needed? For now just logging.
    process.exit(1);
}

export const auth: admin.auth.Auth = admin.auth();
export { admin, db };
