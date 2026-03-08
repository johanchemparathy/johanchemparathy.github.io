// ─────────────────────────────────────────────────────────────────────────────
// admin.js — FormaMaker orders dashboard
// ─────────────────────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// ─── State ────────────────────────────────────────────────────────────────────

let allOrders       = [];
let activeFilter    = "all";
let unsubscribeOrders = null;


// ─── DOM refs ─────────────────────────────────────────────────────────────────

const loginScreen  = document.getElementById("login-screen");
const dashboard    = document.getElementById("dashboard");
const loginForm    = document.getElementById("login-form");
const loginError   = document.getElementById("login-error");
const loginBtn     = document.getElementById("login-btn");
const signoutBtn   = document.getElementById("signout-btn");
const adminEmail   = document.getElementById("admin-user-email");
const ordersList   = document.getElementById("orders-list");
const filterBtns   = document.querySelectorAll(".status-filter-btn");


// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, user => {
  if (user) {
    showDashboard(user);
  } else {
    showLogin();
  }
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
  if (unsubscribeOrders) unsubscribeOrders();
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
    "auth/user-not-found":        "No account found with that email.",
    "auth/wrong-password":        "Incorrect password.",
    "auth/invalid-email":         "Please enter a valid email.",
    "auth/too-many-requests":     "Too many attempts. Try again later.",
    "auth/invalid-credential":    "Invalid email or password.",
  };
  return map[code] || "Sign in failed. Please try again.";
}


// ═════════════════════════════════════════════════════════════════════════════
// ORDERS — FIRESTORE
// ═════════════════════════════════════════════════════════════════════════════

function subscribeToOrders() {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));

  unsubscribeOrders = onSnapshot(q, snapshot => {
    allOrders = snapshot.docs.map(d => ({ _id: d.id, ...d.data() }));
    updateStats();
    renderOrders();
  }, err => {
    console.error("Firestore error:", err);
    ordersList.innerHTML = `
      <div class="admin-state">
        <div class="admin-state-icon">⚠</div>
        <p>Could not load orders. Check Firestore rules allow authenticated reads.</p>
      </div>`;
  });
}

async function updateOrderStatus(orderId, newStatus) {
  await updateDoc(doc(db, "orders", orderId), { status: newStatus });
}


// ═════════════════════════════════════════════════════════════════════════════
// STATS
// ═════════════════════════════════════════════════════════════════════════════

function updateStats() {
  const count = s => allOrders.filter(o => o.status === s).length;
  const inProgress = allOrders.filter(o =>
    o.status === "confirmed" || o.status === "in-progress" || o.status === "ready"
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


// ═════════════════════════════════════════════════════════════════════════════
// RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function renderOrders() {
  const filtered = activeFilter === "all"
    ? allOrders
    : allOrders.filter(o => o.status === activeFilter);

  if (filtered.length === 0) {
    ordersList.innerHTML = `
      <div class="admin-state">
        <div class="admin-state-icon">○</div>
        <p>${allOrders.length === 0 ? "No orders yet." : "No orders match this filter."}</p>
      </div>`;
    return;
  }

  ordersList.innerHTML = filtered.map(order => buildOrderCard(order)).join("");

  // Bind expand toggles
  ordersList.querySelectorAll(".order-summary").forEach(row => {
    row.addEventListener("click", () => {
      const card = row.closest(".order-card");
      card.classList.toggle("expanded");
    });
  });

  // Bind status selects
  ordersList.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async e => {
      e.stopPropagation();
      const orderId   = sel.dataset.id;
      const newStatus = sel.value;
      sel.disabled = true;
      try {
        await updateOrderStatus(orderId, newStatus);
      } finally {
        sel.disabled = false;
      }
    });
    // Prevent expand toggle when clicking the select
    sel.addEventListener("click", e => e.stopPropagation());
  });
}

function buildOrderCard(order) {
  const date     = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const itemCount = (order.items || []).reduce((s, i) => s + (i.qty || 1), 0);
  const status    = order.status || "new";

  const itemsRows = (order.items || []).map(item => `
    <tr>
      <td>${escHtml(item.name)}</td>
      <td>${escHtml(item.category || "")}</td>
      <td class="td-right">${item.qty}</td>
      <td class="td-right">$${(item.price || 0).toFixed(2)}</td>
      <td class="td-right">$${(item.subtotal || (item.price * item.qty) || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  const statusOptions = ["new","confirmed","in-progress","ready","delivered","cancelled"]
    .map(s => `<option value="${s}"${s === status ? " selected" : ""}>${capitalize(s)}</option>`)
    .join("");

  return `
    <div class="order-card" data-id="${order._id}">
      <div class="order-summary" role="button" aria-expanded="false" tabindex="0">
        <div class="order-col-main">
          <div class="order-id">#${order._id.slice(0, 8).toUpperCase()}</div>
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
          <div>
            <div class="detail-section-label">Customer</div>
            <div class="detail-val">${escHtml(order.customerName || "—")}</div>
          </div>
          <div>
            <div class="detail-section-label">Ordered</div>
            <div class="detail-val">${date}</div>
          </div>
          <div>
            <div class="detail-section-label">Product Details</div>
            <div class="detail-val">${escHtml(order.productDetails || "—")}</div>
          </div>
          <div>
            <div class="detail-section-label">Delivery Details</div>
            <div class="detail-val">${escHtml(order.deliveryDetails || "—")}</div>
          </div>
        </div>

        <div class="detail-section-label">Items</div>
        <table class="order-items-table">
          <thead>
            <tr>
              <th>Product</th><th>Category</th>
              <th class="td-right">Qty</th>
              <th class="td-right">Unit</th>
              <th class="td-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>

        <div class="order-total-row">
          <span style="color:var(--text-muted);font-size:.8rem;">Order Total</span>
          <strong>$${(order.total || 0).toFixed(2)}</strong>
        </div>

        <div class="status-update-bar">
          <label for="status-${order._id}">Update status:</label>
          <select class="status-select" id="status-${order._id}" data-id="${order._id}">
            ${statusOptions}
          </select>
        </div>
      </div>
    </div>
  `;
}


// ═════════════════════════════════════════════════════════════════════════════
// FILTER
// ═════════════════════════════════════════════════════════════════════════════

filterBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    filterBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.status;
    renderOrders();
  });
});


// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).replace("-", " ");
}
