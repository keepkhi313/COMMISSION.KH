const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineString } = require("firebase-functions/params");
const generatePromptPay = require("promptpay-qr");
const QRCode = require("qrcode");

setGlobalOptions({ region: "asia-southeast1" });
initializeApp();
const db = getFirestore();
const PROMPTPAY_ID = defineString("PROMPTPAY_ID");
const ADMIN_EMAIL = defineString("ADMIN_EMAIL");
const ACTIVE = ["awaiting_payment", "paid", "in_progress"];
const VALID_STATUS = ["awaiting_payment", "paid", "in_progress", "completed", "cancelled"];

function requireAdmin(request) {
  if (!request.auth || request.auth.token.admin !== true)
    throw new HttpsError("permission-denied", "เฉพาะ Artist เท่านั้น");
}
function cleanText(value, max = 3000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

exports.bootstrapAdmin = onCall(async request => {
  if (!request.auth || request.auth.token.email !== ADMIN_EMAIL.value())
    throw new HttpsError("permission-denied", "ไม่อนุญาต");
  await getAuth().setCustomUserClaims(request.auth.uid, { admin: true });

  const settingsRef = db.doc("settings/public");
  await db.runTransaction(async tx => {
    const snap = await tx.get(settingsRef);
    if (!snap.exists) tx.set(settingsRef, { isOpen: true, maxSlots: 5, activeSlots: 0, artistName: "ART STUDIO" });
  });

  const defaults = [
    { id: "headshot", name: "Headshot", price: 500, description: "Portrait / Head and shoulders" },
    { id: "halfbody", name: "Half Body", price: 900, description: "Waist-up illustration" },
    { id: "fullbody", name: "Full Body", price: 1500, description: "Full character illustration" }
  ];
  for (const s of defaults) {
    const ref = db.doc(`services/${s.id}`);
    const snap = await ref.get();
    if (!snap.exists) await ref.set(s);
  }
  return { success: true };
});

exports.createOrder = onCall(async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบ");
  const data = request.data || {};
  const name = cleanText(data.name, 100);
  const contact = cleanText(data.contact, 150);
  const details = cleanText(data.details, 3000);
  const reference = cleanText(data.reference, 500);
  const serviceId = cleanText(data.serviceId, 50);
  if (!name || !contact || !details || !serviceId)
    throw new HttpsError("invalid-argument", "กรุณากรอกข้อมูลให้ครบ");
  if (reference && !/^https:\\/\\//i.test(reference))
    throw new HttpsError("invalid-argument", "ลิงก์ Reference ต้องเป็น HTTPS");

  const serviceRef = db.doc(`services/${serviceId}`);
  const settingsRef = db.doc("settings/public");
  const orderRef = db.collection("orders").doc();
  let amount = 0, serviceName = "", queueNumber = 0;

  await db.runTransaction(async tx => {
    const serviceSnap = await tx.get(serviceRef);
    const settingsSnap = await tx.get(settingsRef);
    if (!serviceSnap.exists || !settingsSnap.exists)
      throw new HttpsError("not-found", "ไม่พบข้อมูลบริการ");
    const service = serviceSnap.data(), settings = settingsSnap.data();
    if (!settings.isOpen) throw new HttpsError("failed-precondition", "ขณะนี้ปิดรับงาน");
    if (settings.activeSlots >= settings.maxSlots)
      throw new HttpsError("resource-exhausted", "คิวเต็มแล้ว");
    if (!Number.isSafeInteger(service.price) || service.price <= 0)
      throw new HttpsError("failed-precondition", "ราคาไม่ถูกต้อง");

    amount = service.price;
    serviceName = service.name;
    queueNumber = settings.activeSlots + 1;
    tx.create(orderRef, {
      customerUid: request.auth.uid, name, contact, details, reference,
      serviceId, serviceName, amount, queueNumber,
      status: "awaiting_payment", paymentProofUrl: null,
      createdAt: FieldValue.serverTimestamp()
    });
    tx.update(settingsRef, { activeSlots: settings.activeSlots + 1 });
  });

  const payload = generatePromptPay(PROMPTPAY_ID.value(), { amount });
  const qrDataUrl = await QRCode.toDataURL(payload, { width: 400, margin: 2 });
  return { orderId: orderRef.id, amount, serviceName, queueNumber, qrDataUrl };
});

exports.updateOrderStatus = onCall(async request => {
  requireAdmin(request);
  const { orderId, status } = request.data || {};
  if (typeof orderId !== "string" || !VALID_STATUS.includes(status))
    throw new HttpsError("invalid-argument", "ข้อมูลไม่ถูกต้อง");

  const orderRef = db.doc(`orders/${orderId}`);
  const settingsRef = db.doc("settings/public");
  await db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    const settingsSnap = await tx.get(settingsRef);
    if (!orderSnap.exists || !settingsSnap.exists)
      throw new HttpsError("not-found", "ไม่พบออเดอร์");
    const order = orderSnap.data(), settings = settingsSnap.data();
    if (status === "paid" && !order.paymentProofUrl)
      throw new HttpsError("failed-precondition", "ลูกค้ายังไม่ได้แนบหลักฐานการชำระเงิน");

    const wasActive = ACTIVE.includes(order.status);
    const willBeActive = ACTIVE.includes(status);
    let count = settings.activeSlots;
    if (wasActive && !willBeActive) count--;
    if (!wasActive && willBeActive) {
      if (count >= settings.maxSlots) throw new HttpsError("resource-exhausted", "คิวเต็ม");
      count++;
    }
    tx.update(orderRef, { status, updatedAt: FieldValue.serverTimestamp() });
    tx.update(settingsRef, { activeSlots: Math.max(0, count) });
  });
  return { success: true };
});

exports.updateSettings = onCall(async request => {
  requireAdmin(request);
  const { isOpen, maxSlots } = request.data || {};
  if (typeof isOpen !== "boolean" || !Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 100)
    throw new HttpsError("invalid-argument", "ข้อมูลไม่ถูกต้อง");
  const ref = db.doc("settings/public");
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "ไม่พบการตั้งค่า");
    if (maxSlots < snap.data().activeSlots)
      throw new HttpsError("failed-precondition", "จำนวนคิวสูงสุดต้องไม่น้อยกว่าคิวที่กำลังดำเนินการ");
    tx.update(ref, { isOpen, maxSlots, updatedAt: FieldValue.serverTimestamp() });
  });
  return { success: true };
});

exports.upsertService = onCall(async request => {
  requireAdmin(request);
  const { id, name, price, description } = request.data || {};
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(id) ||
      typeof name !== "string" || !name.trim() || name.length > 80 ||
      !Number.isSafeInteger(price) || price <= 0 || price > 1000000)
    throw new HttpsError("invalid-argument", "ข้อมูลราคาไม่ถูกต้อง");
  await db.doc(`services/${id}`).set({
    name: cleanText(name, 80), price, description: cleanText(description, 300),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { success: true };
});
