import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyB8k30KNDOecdEnCNgBAH7T5UI-ZbbfxxM',
  authDomain: 'wireup-6002.firebaseapp.com',
  projectId: 'wireup-6002',
  storageBucket: 'wireup-6002.firebasestorage.app',
  messagingSenderId: '919869667633',
  appId: '1:919869667633:web:0b4f28d4cef6523daf5810',
  measurementId: 'G-Q5FHNJ36L9',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
