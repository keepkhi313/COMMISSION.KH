# ART STUDIO — Commission Website

เว็บไซต์ตัวอย่าง Art Commission ใช้ HTML/CSS/JavaScript และ Firebase

## โครงสร้าง
- `public/index.html` หน้าเว็บลูกค้าและ Artist Dashboard
- `functions/index.js` Backend สำหรับสร้างออเดอร์, ตรวจคิว, สร้าง PromptPay QR และจัดการสถานะ
- `firestore.rules` กฎความปลอดภัย Firestore
- `storage.rules` กฎความปลอดภัย Storage
- `firebase.json` การตั้งค่า Firebase Hosting/Functions

## ก่อนใช้งาน
1. สร้าง Firebase project ใหม่
2. เปิด Authentication: Email/Password และ Anonymous
3. สร้าง Firestore Database และ Storage
4. เพิ่มผู้ใช้ Artist ใน Firebase Authentication ด้วยอีเมล/รหัสผ่าน
5. ใส่ Firebase Web Config ใน `public/index.html`
6. ตั้งค่า `PROMPTPAY_ID` และ `ADMIN_EMAIL` สำหรับ Functions
7. ติดตั้ง Firebase CLI และ deploy

## ติดตั้ง
```bash
npm install -g firebase-tools
firebase login
firebase use --add
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules,storage
firebase deploy --only hosting
```

เมื่อ deploy Functions ครั้งแรก Firebase CLI จะให้กำหนดค่า `PROMPTPAY_ID` และ `ADMIN_EMAIL`
- `PROMPTPAY_ID`: PromptPay ID ของผู้รับเงิน (เลขบัตรประชาชนหรือเบอร์โทรศัพท์ที่ผูก PromptPay)
- `ADMIN_EMAIL`: อีเมลเดียวกับบัญชี Artist ที่สร้างใน Firebase Authentication

## เริ่มต้นใช้งาน Admin
เปิดเว็บไซต์ กรอกอีเมลและรหัสผ่าน Artist ในส่วน Admin Login ระบบ `bootstrapAdmin` จะกำหนดสิทธิ์ admin ให้บัญชีที่ตรงกับ `ADMIN_EMAIL` และสร้างการตั้งค่า/ราคาเริ่มต้น

## ข้อจำกัดและข้อควรระวัง
- QR เป็น PromptPay QR ตามยอดที่ Backend คำนวณจากราคาใน Firestore
- การแนบสลิปไม่ใช่การยืนยันเงินเข้าอัตโนมัติ Artist ต้องตรวจสอบยอดเงินจริงจากแอปธนาคารก่อนเปลี่ยนสถานะเป็น paid
- เวอร์ชันนี้ยังไม่เชื่อม API ตรวจสอบสลิป/ธนาคาร และไม่มีระบบแจ้งเตือนอีเมล
- การสร้างออเดอร์จะกันคิวทันทีตั้งแต่สถานะ awaiting_payment เพื่อไม่ให้รับเกินจำนวนคิวที่ตั้งไว้ หากลูกค้าไม่ชำระเงิน Artist ต้องยกเลิกออเดอร์เพื่อคืนคิว
- ก่อนเปิดรับลูกค้าจริง ให้ทดสอบด้วยยอด/บัญชีทดสอบและตรวจสอบ Firebase Security Rules
- Cloud Functions ต้องใช้แผน Firebase ที่รองรับการ deploy Functions และอาจมีค่าใช้จ่าย
- อย่าเผยแพร่ Service Account private key หรือรหัสผ่าน Admin
