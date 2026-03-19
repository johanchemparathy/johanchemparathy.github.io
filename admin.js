// ─────────────────────────────────────────────────────────────────────────────
// admin.js — FormaMaker admin dashboard (orders + inventory)
// ─────────────────────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import {
  createOrderWithInventory,
  deleteOrderWithInventory,
  generateProductId,
  getAvailableCount,
  normalizeProduct,
  parseInventoryCountInput,
  sanitizeProductId,
  updateOrderStatusWithInventory,
} from "./inventory.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// ─── State ────────────────────────────────────────────────────────────────────

let allOrders        = [];
let allProducts      = [];
let allExpenses      = [];
let activeFilter     = "all";
let editingDocId     = null;   // null = new product, string = editing existing
let editingExpenseId = null;
let unsubOrders      = null;
let unsubProducts    = null;
let unsubExpenses    = null;


// ─── DOM refs ─────────────────────────────────────────────────────────────────

const loginScreen    = document.getElementById("login-screen");
const dashboard      = document.getElementById("dashboard");
const loginForm      = document.getElementById("login-form");
const loginError     = document.getElementById("login-error");
const loginBtn       = document.getElementById("login-btn");
const signoutBtn     = document.getElementById("signout-btn");
const adminEmail     = document.getElementById("admin-user-email");
const ordersList     = document.getElementById("orders-list");
const inventoryList  = document.getElementById("inventory-list");
const expensesList   = document.getElementById("expenses-list");
const filterBtns     = document.querySelectorAll(".status-filter-btn");
const modalOverlay   = document.getElementById("product-modal-overlay");
const productForm    = document.getElementById("product-form");
const modalTitle     = document.getElementById("product-modal-title");
const productSaveBtn = document.getElementById("product-save-btn");
const formError      = document.getElementById("product-form-error");


// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, user => {
  if (user) showDashboard(user);
  else      showLogin();
});

loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  loginBtn.disabled    = true;
  loginBtn.textContent = "Signing in…";
  hideLoginError();
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showLoginError(friendlyAuthError(err.code));
    loginBtn.disabled    = false;
    loginBtn.textContent = "Sign In";
  }
});

signoutBtn.addEventListener("click", async () => {
  unsubOrders?.();
  unsubProducts?.();
  unsubExpenses?.();
  await signOut(auth);
});

function showLogin() {
  loginScreen.style.display = "flex";
  dashboard.style.display   = "none";
  loginBtn.disabled          = false;
  loginBtn.textContent       = "Sign In";
}

function showDashboard(user) {
  loginScreen.style.display = "none";
  dashboard.style.display   = "block";
  adminEmail.textContent    = user.email;
  subscribeToOrders();
  subscribeToProducts();
  subscribeToExpenses();
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.add("visible");
}

function hideLoginError() {
  loginError.classList.remove("visible");
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found":     "No account found with that email.",
    "auth/wrong-password":     "Incorrect password.",
    "auth/invalid-email":      "Please enter a valid email.",
    "auth/too-many-requests":  "Too many attempts. Try again later.",
    "auth/invalid-credential": "Invalid email or password.",
  };
  return map[code] || "Sign in failed. Please try again.";
}


// ═════════════════════════════════════════════════════════════════════════════
// TABS
// ═════════════════════════════════════════════════════════════════════════════

document.querySelectorAll(".admin-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// ORDERS
// ═════════════════════════════════════════════════════════════════════════════

function subscribeToOrders() {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  unsubOrders = onSnapshot(q, snapshot => {
    allOrders = snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
    updateStats();
    updateFinancials();
    renderOrders();
  }, err => {
    console.error("Firestore orders error:", err);
    ordersList.innerHTML = `<div class="admin-state"><div class="admin-state-icon">⚠</div><p>Could not load orders. Check Firestore rules allow authenticated reads.</p></div>`;
  });
}

async function updateOrderStatus(orderId, newStatus) {
  await updateOrderStatusWithInventory(orderId, newStatus);
}

function updateStats() {
  const count = s => allOrders.filter(o => o.status === s).length;
  const inProgress = allOrders.filter(o =>
    ["confirmed","in-progress","ready"].includes(o.status)
  ).length;
  const revenue = allOrders
    .filter(o => o.status !== "cancelled")
    .reduce((sum, o) => sum + (o.total || 0), 0);
  document.getElementById("stat-total").textContent     = allOrders.length;
  document.getElementById("stat-new").textContent       = count("new");
  document.getElementById("stat-progress").textContent  = inProgress;
  document.getElementById("stat-delivered").textContent = count("delivered");
  document.getElementById("stat-revenue").textContent   = `$${revenue.toFixed(2)}`;
}

function updateFinancials() {
  const revenue  = allOrders
    .filter(o => o.status !== "cancelled")
    .reduce((sum, o) => sum + (o.total || 0), 0);
  const expenses = allExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const profit   = revenue - expenses;

  document.getElementById("fin-revenue").textContent  = `$${revenue.toFixed(2)}`;
  document.getElementById("fin-expenses").textContent = `$${expenses.toFixed(2)}`;

  const profitEl = document.getElementById("fin-profit");
  profitEl.textContent = `${profit < 0 ? "-" : ""}$${Math.abs(profit).toFixed(2)}`;
  profitEl.className   = `fin-value ${profit >= 0 ? "profit" : "loss"}`;
}

function renderOrders() {
  const filtered = activeFilter === "all"
    ? allOrders
    : allOrders.filter(o => o.status === activeFilter);

  if (filtered.length === 0) {
    ordersList.innerHTML = `<div class="admin-state"><div class="admin-state-icon">○</div><p>${allOrders.length === 0 ? "No orders yet." : "No orders match this filter."}</p></div>`;
    return;
  }

  ordersList.innerHTML = filtered.map(buildOrderCard).join("");

  ordersList.querySelectorAll(".order-summary").forEach(row => {
    row.addEventListener("click", () => row.closest(".order-card").classList.toggle("expanded"));
  });

  ordersList.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async e => {
      e.stopPropagation();
      sel.disabled = true;
      const existingOrder = allOrders.find(order => order._id === sel.dataset.id);
      try {
        await updateOrderStatus(sel.dataset.id, sel.value);
      } catch (err) {
        console.error("Update order status error:", err);
        sel.value = existingOrder?.status || "new";
        alert(err.message || "Failed to update order status.");
      } finally {
        sel.disabled = false;
      }
    });
    sel.addEventListener("click", e => e.stopPropagation());
  });

  ordersList.querySelectorAll(".delete-order-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm("Delete this order? This cannot be undone.")) return;
      btn.disabled = true;
      try {
        await deleteOrderWithInventory(btn.dataset.id);
      } catch (err) {
        console.error("Delete order error:", err);
        alert(err.message || "Failed to delete order.");
        btn.disabled = false;
      }
    });
  });
}

function buildOrderCard(order) {
  const date = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const itemCount = (order.items || []).reduce((s, i) => s + (i.qty || 1), 0);
  const status = order.status || "new";
  const itemsRows = (order.items || []).map(item => `
    <tr>
      <td>
        <div>${escHtml(item.name)}</div>
        ${item.productId ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">${escHtml(item.productId)}</div>` : ""}
      </td>
      <td>${escHtml(item.category || "")}</td>
      <td class="td-right">${item.qty}</td>
      <td class="td-right">$${(item.price || 0).toFixed(2)}</td>
      <td class="td-right">$${(item.subtotal || item.price * item.qty || 0).toFixed(2)}</td>
    </tr>`).join("");
  const statusOptions = ["new","confirmed","in-progress","ready","delivered","cancelled"]
    .map(s => `<option value="${s}"${s === status ? " selected" : ""}>${capitalize(s)}</option>`).join("");

  const adminBadge = order.source === "admin"
    ? `<span class="admin-order-badge">Admin</span>` : "";

  return `
    <div class="order-card" data-id="${order._id}">
      <div class="order-summary" role="button" tabindex="0">
        <div class="order-col-main">
          <div class="order-id">#${order._id.slice(0,8).toUpperCase()}${adminBadge}</div>
          <div class="order-customer">${escHtml(order.customerName || "—")}</div>
          <div class="order-items-count">${itemCount} item${itemCount !== 1 ? "s" : ""}</div>
        </div>
        <div class="order-col-date">${date}</div>
        <div class="order-col-total">$${(order.total || 0).toFixed(2)}</div>
        <span class="status-badge status-${status}">${capitalize(status)}</span>
        <span class="order-toggle-icon" aria-hidden="true">▾</span>
      </div>
      <div class="order-detail">
        <div class="detail-grid">
          <div><div class="detail-section-label">Customer</div><div class="detail-val">${escHtml(order.customerName || "—")}</div></div>
          <div><div class="detail-section-label">Ordered</div><div class="detail-val">${date}</div></div>
          <div><div class="detail-section-label">Product Details</div><div class="detail-val">${escHtml(order.productDetails || "—")}</div></div>
          <div><div class="detail-section-label">Delivery Details</div><div class="detail-val">${escHtml(order.deliveryDetails || "—")}</div></div>
        </div>
        <div class="detail-section-label">Items</div>
        <table class="order-items-table">
          <thead><tr><th>Product</th><th>Category</th><th class="td-right">Qty</th><th class="td-right">Unit</th><th class="td-right">Subtotal</th></tr></thead>
          <tbody>${itemsRows}</tbody>
        </table>
        <div class="order-total-row"><span style="color:var(--text-muted);font-size:.8rem;">Order Total</span><strong>$${(order.total || 0).toFixed(2)}</strong></div>
        <div class="status-update-bar">
          <label for="status-${order._id}">Update status:</label>
          <select class="status-select" id="status-${order._id}" data-id="${order._id}">${statusOptions}</select>
          <button class="btn btn-danger btn-sm delete-order-btn" data-id="${order._id}">Delete</button>
        </div>
      </div>
    </div>`;
}

filterBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    filterBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.status;
    renderOrders();
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═════════════════════════════════════════════════════════════════════════════

function subscribeToProducts() {
  const q = query(collection(db, "products"), orderBy("name"));
  unsubProducts = onSnapshot(q, snapshot => {
    allProducts = snapshot.docs.map(d => normalizeProduct({ _docId: d.id, ...d.data() }, d.id));
    renderInventory();
    populateCategoryDatalist();
  }, err => {
    console.error("Firestore products error:", err);
    inventoryList.innerHTML = `<div class="admin-state" style="grid-column:1/-1"><div class="admin-state-icon">⚠</div><p>Could not load products. Check Firestore rules.</p></div>`;
  });
}

function renderInventory() {
  const countEl = document.getElementById("inv-count");
  if (countEl) countEl.textContent = `(${allProducts.length})`;

  if (allProducts.length === 0) {
    inventoryList.innerHTML = `
      <div class="admin-state" style="grid-column:1/-1">
        <div class="admin-state-icon">○</div>
        <p>No products yet. Add one to get started.</p>
      </div>`;
    return;
  }

  inventoryList.innerHTML = allProducts.map(buildInventoryCard).join("");

  inventoryList.querySelectorAll(".inv-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openProductModal(btn.dataset.id));
  });

  inventoryList.querySelectorAll(".inv-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => confirmDeleteProduct(btn.dataset.id, btn.dataset.name));
  });
}

function buildInventoryCard(p) {
  const imgs  = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
  const thumb = imgs[0] || "https://placehold.co/400x400/F1F1F3/71717A?text=No+Image";
  const price = `$${Number(p.price || 0).toFixed(2)}`;
  const oldPriceTag = p.oldPrice ? ` <span style="text-decoration:line-through;color:var(--text-muted);font-size:.78rem;">$${Number(p.oldPrice).toFixed(2)}</span>` : "";
  const totalCount = p.totalCount === null ? "Not set" : p.totalCount;
  const availableCount = p.availableCount === null ? "Not set" : p.availableCount;
  const stockClass = p.availableCount === 0 ? " inv-stock-pill soldout" : " inv-stock-pill";

  return `
    <div class="inv-card">
      <img class="inv-thumb" src="${escHtml(thumb)}" alt="${escHtml(p.name || "")}"
        onerror="this.src='https://placehold.co/400x400/F1F1F3/71717A?text=No+Image'">
      <div class="inv-body">
        <div class="inv-name">${escHtml(p.name || "Untitled")}</div>
        <div class="inv-cat">${escHtml(p.category || "")}</div>
        <div class="inv-product-id">${escHtml(p.productId || "Not set")}</div>
        <div class="inv-stock-grid">
          <div class="inv-stock-pill">
            <span>Total</span>
            <strong>${escHtml(String(totalCount))}</strong>
          </div>
          <div class="${stockClass.trim()}">
            <span>Available</span>
            <strong>${escHtml(String(availableCount))}</strong>
          </div>
        </div>
        ${p.featured ? `<span class="inv-featured">Featured</span>` : ""}
        <div class="inv-price">${price}${oldPriceTag}</div>
      </div>
      <div class="inv-actions">
        <button class="btn btn-outline btn-sm inv-edit-btn" data-id="${p._docId}">Edit</button>
        <button class="btn btn-danger btn-sm inv-delete-btn" data-id="${p._docId}" data-name="${escHtml(p.name || "")}">Delete</button>
      </div>
    </div>`;
}

function populateCategoryDatalist() {
  const dl = document.getElementById("category-suggestions");
  if (!dl) return;
  const cats = [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort();
  dl.innerHTML = cats.map(c => `<option value="${escHtml(c)}">`).join("");
}


// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function openProductModal(docId = null) {
  editingDocId = docId;
  formError.style.display = "none";
  productForm.reset();
  modalTitle.textContent = docId ? "Edit Product" : "Add Product";

  if (docId) {
    const p = allProducts.find(x => x._docId === docId);
    if (!p) return;
    document.getElementById("pf-name").value         = p.name || "";
    document.getElementById("pf-product-id").value   = p.productId || "";
    document.getElementById("pf-category").value     = p.category || "";
    document.getElementById("pf-price").value        = p.price ?? "";
    document.getElementById("pf-old-price").value    = p.oldPrice ?? "";
    document.getElementById("pf-rating").value       = p.rating ?? "";
    document.getElementById("pf-review-count").value = p.reviewCount ?? "";
    document.getElementById("pf-total-count").value  = p.totalCount ?? "";
    document.getElementById("pf-available-count").value = p.availableCount ?? "";
    document.getElementById("pf-description").value  = p.description || "";
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
    document.getElementById("pf-images").value       = imgs.join("\n");
    document.getElementById("pf-featured").checked   = !!p.featured;
  }

  modalOverlay.style.display = "flex";
  document.getElementById("pf-name").focus();
}

function closeProductModal() {
  modalOverlay.style.display = "none";
  editingDocId = null;
}

document.getElementById("product-modal-close").addEventListener("click", closeProductModal);
document.getElementById("product-modal-cancel").addEventListener("click", closeProductModal);
modalOverlay.addEventListener("click", e => { if (e.target === modalOverlay) closeProductModal(); });

document.getElementById("add-product-btn").addEventListener("click", () => openProductModal());

productSaveBtn.addEventListener("click", async () => {
  formError.style.display = "none";

  const name     = document.getElementById("pf-name").value.trim();
  const category = document.getElementById("pf-category").value.trim();
  const price    = parseFloat(document.getElementById("pf-price").value);
  const totalRaw = document.getElementById("pf-total-count").value.trim();
  const availableRaw = document.getElementById("pf-available-count").value.trim();

  if (!name)         { showFormError("Name is required."); return; }
  if (!category)     { showFormError("Category is required."); return; }
  if (isNaN(price))  { showFormError("A valid price is required."); return; }
  if (!totalRaw)     { showFormError("Total count is required."); return; }
  if (!availableRaw) { showFormError("Available count is required."); return; }

  const oldPriceRaw   = document.getElementById("pf-old-price").value.trim();
  const ratingRaw     = document.getElementById("pf-rating").value.trim();
  const reviewRaw     = document.getElementById("pf-review-count").value.trim();
  const imagesRaw     = document.getElementById("pf-images").value.trim();
  const imagesList    = imagesRaw ? imagesRaw.split("\n").map(s => s.trim()).filter(Boolean) : [];
  const totalCount    = parseInventoryCountInput(totalRaw);
  const availableCount = parseInventoryCountInput(availableRaw);

  if (totalCount === null)     { showFormError("Total count must be a whole number."); return; }
  if (availableCount === null) { showFormError("Available count must be a whole number."); return; }
  if (availableCount > totalCount) {
    showFormError("Available count cannot be greater than total count.");
    return;
  }

  const takenProductIds = new Set(
    allProducts
      .filter(product => product._docId !== editingDocId)
      .map(product => product.productId)
      .filter(Boolean)
  );
  const rawProductId = document.getElementById("pf-product-id").value.trim();
  const productId = sanitizeProductId(rawProductId) || generateProductId(name, takenProductIds);

  if (takenProductIds.has(productId)) {
    showFormError("Product ID must be unique.");
    return;
  }

  const data = {
    productId,
    name,
    category,
    price,
    totalCount,
    availableCount,
    oldPrice:    oldPriceRaw     ? parseFloat(oldPriceRaw)  : null,
    rating:      ratingRaw       ? parseFloat(ratingRaw)    : 0,
    reviewCount: reviewRaw       ? parseInt(reviewRaw, 10)  : 0,
    description: document.getElementById("pf-description").value.trim(),
    images:      imagesList,
    featured:    document.getElementById("pf-featured").checked,
    updatedAt:   serverTimestamp(),
  };

  productSaveBtn.disabled    = true;
  productSaveBtn.textContent = "Saving…";

  try {
    if (editingDocId) {
      await updateDoc(doc(db, "products", editingDocId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), data);
    }
    closeProductModal();
  } catch (err) {
    console.error("Save product error:", err);
    showFormError("Failed to save. Please try again.");
  } finally {
    productSaveBtn.disabled    = false;
    productSaveBtn.textContent = "Save Product";
  }
});

function showFormError(msg) {
  formError.textContent   = msg;
  formError.style.display = "block";
}


// ─── Delete ───────────────────────────────────────────────────────────────────

function confirmDeleteProduct(docId, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  deleteDoc(doc(db, "products", docId)).catch(err => {
    console.error("Delete error:", err);
    alert("Failed to delete product.");
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// ADD ORDER MODAL (admin verbal order entry)
// ═════════════════════════════════════════════════════════════════════════════

let orderModalItems = [];  // [{ id, name, category, price, image, qty }]

const orderModalOverlay = document.getElementById("order-modal-overlay");
const orderModalForm    = document.getElementById("order-modal-form");
const orderFormError    = document.getElementById("order-form-error");
const orderSaveBtn      = document.getElementById("order-save-btn");

function openOrderModal() {
  orderModalItems = [];
  orderModalForm.reset();
  orderFormError.style.display = "none";
  populateProductPicker();
  renderOrderModalItems();
  orderModalOverlay.style.display = "flex";
  document.getElementById("of-name").focus();
}

function closeOrderModal() {
  orderModalOverlay.style.display = "none";
  orderModalItems = [];
}

function populateProductPicker() {
  const picker = document.getElementById("of-product-picker");
  picker.innerHTML =
    '<option value="">— Select a product —</option>' +
    allProducts.map(p => {
      const available = getAvailableCount(p);
      const stockLabel = available === null
        ? "stock not set"
        : `${available} available`;
      return `<option value="${p._docId}">${escHtml(p.name)} (${escHtml(p.productId || p._docId)}) — $${Number(p.price).toFixed(2)} — ${stockLabel}</option>`;
    }).join("");
}

function validateTrackedInventory(product, requestedQty) {
  const available = getAvailableCount(product);
  if (available === null) return true;
  if (requestedQty <= available) return true;

  const label = product.name || product.productId || "This product";
  showOrderFormError(`${label} only has ${available} available.`);
  return false;
}

function findProductByDocId(docId) {
  return allProducts.find(product => product._docId === docId);
}

function refreshOrderModalInventoryError() {
  if (orderFormError.style.display === "none") return;
  orderFormError.style.display = "none";
}

function addOrderModalItem(docId) {
  if (!docId) return;
  const p = findProductByDocId(docId);
  if (!p) return;
  const existing = orderModalItems.find(i => i.id === docId);
  const nextQty = (existing?.qty || 0) + 1;
  refreshOrderModalInventoryError();
  if (!validateTrackedInventory(p, nextQty)) return;

  if (existing) {
    existing.qty = nextQty;
  } else {
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
    orderModalItems.push({
      id: docId,
      productId: p.productId || "",
      name: p.name,
      category: p.category || "",
      price: Number(p.price),
      image: imgs[0] || "",
      qty: 1,
    });
  }
  renderOrderModalItems();
}

function removeOrderModalItem(docId) {
  orderModalItems = orderModalItems.filter(i => i.id !== docId);
  refreshOrderModalInventoryError();
  renderOrderModalItems();
}

function changeOrderModalItemQty(docId, delta) {
  const item = orderModalItems.find(i => i.id === docId);
  if (!item) return;
  const nextQty = item.qty + delta;
  if (nextQty <= 0) { removeOrderModalItem(docId); return; }

  const product = findProductByDocId(docId);
  refreshOrderModalInventoryError();
  if (product && !validateTrackedInventory(product, nextQty)) return;

  item.qty = nextQty;
  renderOrderModalItems();
}

function renderOrderModalItems() {
  const listEl  = document.getElementById("of-items-list");
  const rowsEl  = document.getElementById("of-items-rows");
  const totalEl = document.getElementById("of-total");

  if (orderModalItems.length === 0) {
    listEl.style.display = "none";
    return;
  }

  listEl.style.display = "block";
  const total = orderModalItems.reduce((s, i) => s + i.price * i.qty, 0);
  totalEl.textContent = `$${total.toFixed(2)}`;

  rowsEl.innerHTML = orderModalItems.map(item => `
    <div class="om-item-row" data-id="${item.id}">
      <div class="om-item-name">
        <div>${escHtml(item.name)}</div>
        ${item.productId ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">${escHtml(item.productId)}</div>` : ""}
      </div>
      <div class="om-qty-controls">
        <button type="button" class="om-qty-btn" data-id="${item.id}" data-delta="-1">−</button>
        <span class="om-qty-val">${item.qty}</span>
        <button type="button" class="om-qty-btn" data-id="${item.id}" data-delta="1">+</button>
      </div>
      <div class="om-line-total">$${(item.price * item.qty).toFixed(2)}</div>
      <button type="button" class="om-remove-btn" data-id="${item.id}" aria-label="Remove">✕</button>
    </div>
  `).join("");

  rowsEl.querySelectorAll(".om-qty-btn").forEach(btn =>
    btn.addEventListener("click", () =>
      changeOrderModalItemQty(btn.dataset.id, parseInt(btn.dataset.delta, 10))
    )
  );
  rowsEl.querySelectorAll(".om-remove-btn").forEach(btn =>
    btn.addEventListener("click", () => removeOrderModalItem(btn.dataset.id))
  );
}

function showOrderFormError(msg) {
  orderFormError.textContent   = msg;
  orderFormError.style.display = "block";
}

// Bindings
document.getElementById("add-order-btn").addEventListener("click", openOrderModal);
document.getElementById("order-modal-close").addEventListener("click", closeOrderModal);
document.getElementById("order-modal-cancel").addEventListener("click", closeOrderModal);
orderModalOverlay.addEventListener("click", e => { if (e.target === orderModalOverlay) closeOrderModal(); });

document.getElementById("of-add-item-btn").addEventListener("click", () => {
  const picker = document.getElementById("of-product-picker");
  addOrderModalItem(picker.value);
  picker.value = "";
});

orderSaveBtn.addEventListener("click", async () => {
  orderFormError.style.display = "none";
  const customerName    = document.getElementById("of-name").value.trim();
  const productDetails  = document.getElementById("of-product-details").value.trim();
  const deliveryDetails = document.getElementById("of-delivery").value.trim();

  if (!customerName)          { showOrderFormError("Customer name is required."); return; }
  if (!deliveryDetails)       { showOrderFormError("Delivery details are required."); return; }
  if (orderModalItems.length === 0) { showOrderFormError("Add at least one item to the order."); return; }

  const total = orderModalItems.reduce((s, i) => s + i.price * i.qty, 0);

  const orderData = {
    customerName,
    productDetails,
    deliveryDetails,
    items: orderModalItems.map(item => ({
      id:       item.id,
      productId: item.productId,
      name:     item.name,
      category: item.category,
      price:    item.price,
      qty:      item.qty,
      subtotal: parseFloat((item.price * item.qty).toFixed(2)),
    })),
    total:     parseFloat(total.toFixed(2)),
    status:    "new",
    source:    "admin",
  };

  orderSaveBtn.disabled    = true;
  orderSaveBtn.textContent = "Placing…";

  try {
    await createOrderWithInventory(orderData);
    closeOrderModal();
  } catch (err) {
    console.error("Add order error:", err);
    showOrderFormError(err.message || "Failed to place order. Please try again.");
  } finally {
    orderSaveBtn.disabled    = false;
    orderSaveBtn.textContent = "Place Order";
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═════════════════════════════════════════════════════════════════════════════

function subscribeToExpenses() {
  const q = query(collection(db, "expenses"), orderBy("date", "desc"));
  unsubExpenses = onSnapshot(q, snapshot => {
    allExpenses = snapshot.docs.map(d => ({ _docId: d.id, ...d.data() }));
    updateFinancials();
    renderExpenses();
  }, err => {
    console.error("Firestore expenses error:", err);
    expensesList.innerHTML = `<div class="admin-state"><div class="admin-state-icon">⚠</div><p>Could not load expenses. Check Firestore rules.</p></div>`;
  });
}

function renderExpenses() {
  const countEl = document.getElementById("exp-count");
  if (countEl) {
    const total = allExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    countEl.textContent = allExpenses.length
      ? `(${allExpenses.length} · $${total.toFixed(2)} total)`
      : "";
  }

  if (allExpenses.length === 0) {
    expensesList.innerHTML = `
      <div class="admin-state">
        <div class="admin-state-icon">○</div>
        <p>No expenses recorded yet. Add your first expense.</p>
      </div>`;
    return;
  }

  expensesList.innerHTML = allExpenses.map(buildExpenseRow).join("");

  expensesList.querySelectorAll(".exp-edit-btn").forEach(btn =>
    btn.addEventListener("click", () => openExpenseModal(btn.dataset.id))
  );
  expensesList.querySelectorAll(".exp-delete-btn").forEach(btn =>
    btn.addEventListener("click", () => confirmDeleteExpense(btn.dataset.id, btn.dataset.desc))
  );
}

function buildExpenseRow(e) {
  const dateStr = e.date
    ? new Date(e.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  return `
    <div class="expense-row">
      <div class="expense-date">${dateStr}</div>
      <span class="expense-cat-badge">${escHtml(e.category || "")}</span>
      <div class="expense-desc">${escHtml(e.description || "")}</div>
      <div class="expense-amount">$${Number(e.amount || 0).toFixed(2)}</div>
      <div class="expense-actions">
        <button class="btn btn-outline btn-sm exp-edit-btn" data-id="${e._docId}">Edit</button>
        <button class="btn btn-danger btn-sm exp-delete-btn" data-id="${e._docId}" data-desc="${escHtml(e.description || "")}">Delete</button>
      </div>
    </div>`;
}


// ─── Expense modal ─────────────────────────────────────────────────────────────

const expenseModalOverlay = document.getElementById("expense-modal-overlay");
const expenseForm         = document.getElementById("expense-form");
const expenseFormError    = document.getElementById("expense-form-error");
const expenseSaveBtn      = document.getElementById("expense-save-btn");

function openExpenseModal(docId = null) {
  editingExpenseId = docId;
  expenseForm.reset();
  expenseFormError.style.display = "none";
  document.getElementById("expense-modal-title").textContent = docId ? "Edit Expense" : "Add Expense";

  if (docId) {
    const e = allExpenses.find(x => x._docId === docId);
    if (!e) return;
    document.getElementById("ef-date").value        = e.date || "";
    document.getElementById("ef-amount").value      = e.amount ?? "";
    document.getElementById("ef-category").value    = e.category || "";
    document.getElementById("ef-description").value = e.description || "";
  } else {
    // Default date to today
    document.getElementById("ef-date").value = new Date().toISOString().slice(0, 10);
  }

  expenseModalOverlay.style.display = "flex";
  document.getElementById("ef-description").focus();
}

function closeExpenseModal() {
  expenseModalOverlay.style.display = "none";
  editingExpenseId = null;
}

document.getElementById("expense-modal-close").addEventListener("click", closeExpenseModal);
document.getElementById("expense-modal-cancel").addEventListener("click", closeExpenseModal);
expenseModalOverlay.addEventListener("click", e => { if (e.target === expenseModalOverlay) closeExpenseModal(); });
document.getElementById("add-expense-btn").addEventListener("click", () => openExpenseModal());

expenseSaveBtn.addEventListener("click", async () => {
  expenseFormError.style.display = "none";
  const date        = document.getElementById("ef-date").value;
  const amountRaw   = document.getElementById("ef-amount").value.trim();
  const category    = document.getElementById("ef-category").value.trim();
  const description = document.getElementById("ef-description").value.trim();

  if (!date)                { showExpenseFormError("Date is required."); return; }
  if (!amountRaw || isNaN(parseFloat(amountRaw))) { showExpenseFormError("A valid amount is required."); return; }
  if (!category)            { showExpenseFormError("Category is required."); return; }
  if (!description)         { showExpenseFormError("Description is required."); return; }

  const data = {
    date,
    amount:      parseFloat(parseFloat(amountRaw).toFixed(2)),
    category,
    description,
    updatedAt:   serverTimestamp(),
  };

  expenseSaveBtn.disabled    = true;
  expenseSaveBtn.textContent = "Saving…";

  try {
    if (editingExpenseId) {
      await updateDoc(doc(db, "expenses", editingExpenseId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "expenses"), data);
    }
    closeExpenseModal();
  } catch (err) {
    console.error("Save expense error:", err);
    showExpenseFormError("Failed to save. Please try again.");
  } finally {
    expenseSaveBtn.disabled    = false;
    expenseSaveBtn.textContent = "Save Expense";
  }
});

function showExpenseFormError(msg) {
  expenseFormError.textContent   = msg;
  expenseFormError.style.display = "block";
}

function confirmDeleteExpense(docId, description) {
  if (!confirm(`Delete expense "${description}"? This cannot be undone.`)) return;
  deleteDoc(doc(db, "expenses", docId)).catch(err => {
    console.error("Delete expense error:", err);
    alert("Failed to delete expense.");
  });
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).replace("-", " ");
}
