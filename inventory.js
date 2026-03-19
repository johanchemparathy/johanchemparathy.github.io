import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const CANCELLED_STATUS = "cancelled";

function toCount(value) {
  if (value === "" || value === null || typeof value === "undefined") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

export function parseInventoryCountInput(value) {
  return toCount(value);
}

export function sanitizeProductId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function generateProductId(name, takenIds = new Set()) {
  const slug = sanitizeProductId(name).slice(0, 24) || "PRODUCT";
  const base = `FM-${slug}`;
  let candidate = base;
  let counter = 2;

  while (takenIds.has(candidate)) {
    candidate = `${base}-${counter++}`;
  }

  return candidate;
}

export function normalizeProduct(product, fallbackDocId = "") {
  const fallbackProductId = fallbackDocId
    ? `FM-${String(fallbackDocId).slice(0, 8).toUpperCase()}`
    : "";

  return {
    ...product,
    productId: sanitizeProductId(product?.productId) || fallbackProductId,
    totalCount: toCount(product?.totalCount),
    availableCount: toCount(product?.availableCount),
  };
}

export function isInventoryTracked(product) {
  const normalized = normalizeProduct(product);
  return normalized.totalCount !== null && normalized.availableCount !== null;
}

export function getAvailableCount(product) {
  const normalized = normalizeProduct(product);
  return isInventoryTracked(normalized) ? normalized.availableCount : null;
}

export function orderConsumesInventory(order) {
  return String(order?.status || "new").toLowerCase() !== CANCELLED_STATUS;
}

function buildConsumedItemMap(order) {
  const items = new Map();
  if (!order || !orderConsumesInventory(order)) return items;

  (order.items || []).forEach(item => {
    if (!item?.id) return;
    const qty = toCount(item.qty) || 0;
    if (qty <= 0) return;

    const existing = items.get(item.id) || {
      qty: 0,
      name: item.name || "",
      productId: sanitizeProductId(item.productId || ""),
    };

    existing.qty += qty;
    if (!existing.name && item.name) existing.name = item.name;
    if (!existing.productId && item.productId) {
      existing.productId = sanitizeProductId(item.productId);
    }

    items.set(item.id, existing);
  });

  return items;
}

function buildInventoryDelta(beforeOrder, afterOrder) {
  const beforeItems = buildConsumedItemMap(beforeOrder);
  const afterItems = buildConsumedItemMap(afterOrder);
  const productIds = new Set([...beforeItems.keys(), ...afterItems.keys()]);

  return [...productIds].map(productDocId => {
    const beforeQty = beforeItems.get(productDocId)?.qty || 0;
    const afterQty = afterItems.get(productDocId)?.qty || 0;
    const delta = afterQty - beforeQty;
    if (!delta) return null;

    const meta = afterItems.get(productDocId) || beforeItems.get(productDocId) || {};
    return {
      id: productDocId,
      delta,
      name: meta.name || "",
      productId: meta.productId || "",
    };
  }).filter(Boolean);
}

async function applyInventoryDelta(transaction, deltas) {
  for (const item of deltas) {
    const productRef = doc(db, "products", item.id);
    const productSnap = await transaction.get(productRef);

    if (!productSnap.exists()) {
      throw new Error(`${item.name || item.productId || "Product"} no longer exists.`);
    }

    const product = normalizeProduct({ _docId: productSnap.id, ...productSnap.data() }, productSnap.id);
    if (!isInventoryTracked(product)) continue;

    const currentAvailable = product.availableCount ?? 0;
    if (item.delta > 0) {
      if (currentAvailable < item.delta) {
        const label = product.name || item.name || product.productId || item.productId || "Product";
        throw new Error(`${label} only has ${currentAvailable} available.`);
      }

      transaction.update(productRef, {
        availableCount: currentAvailable - item.delta,
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    const releaseQty = Math.abs(item.delta);
    const maxAvailable = product.totalCount ?? (currentAvailable + releaseQty);
    transaction.update(productRef, {
      availableCount: Math.min(maxAvailable, currentAvailable + releaseQty),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function createOrderWithInventory(orderData) {
  const orderRef = doc(collection(db, "orders"));

  await runTransaction(db, async transaction => {
    await applyInventoryDelta(transaction, buildInventoryDelta(null, orderData));
    transaction.set(orderRef, {
      ...orderData,
      createdAt: serverTimestamp(),
    });
  });

  return orderRef;
}

export async function updateOrderStatusWithInventory(orderId, nextStatus) {
  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw new Error("Order not found.");

    const currentOrder = { _id: orderSnap.id, ...orderSnap.data() };
    const nextOrder = { ...currentOrder, status: nextStatus };

    await applyInventoryDelta(transaction, buildInventoryDelta(currentOrder, nextOrder));
    transaction.update(orderRef, {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function deleteOrderWithInventory(orderId) {
  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) return;

    const currentOrder = { _id: orderSnap.id, ...orderSnap.data() };
    await applyInventoryDelta(transaction, buildInventoryDelta(currentOrder, null));
    transaction.delete(orderRef);
  });
}
