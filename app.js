// ─────────────────────────────────────────────────────────────────────────────
// app.js — FormaMaker application logic
// Products are loaded from Firestore in real-time.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./firebase-config.js";
import {
  createOrderWithInventory,
  getAvailableCount,
  normalizeProduct,
} from "./inventory.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// ─── State ────────────────────────────────────────────────────────────────────

let products       = [];
let categories     = ["All"];
let cart           = JSON.parse(localStorage.getItem("formamaker_cart") || "[]");
let activeCategory = "All";
let searchQuery    = "";


// ─── DOM refs ─────────────────────────────────────────────────────────────────

const els = {
  cartCount:       document.getElementById("cart-count"),
  cartDrawer:      document.getElementById("cart-drawer"),
  cartOverlay:     document.getElementById("cart-overlay"),
  cartItems:       document.getElementById("cart-items"),
  cartSubtotal:    document.getElementById("cart-subtotal"),
  cartEmpty:       document.getElementById("cart-empty"),
  cartFormSection: document.getElementById("cart-form-section"),
  categoryList:    document.getElementById("category-list"),
  productGrid:     document.getElementById("product-grid"),
  featuredGrid:    document.getElementById("featured-grid"),
  searchInput:     document.getElementById("search-input"),
  orderForm:       document.getElementById("order-form"),
  orderSuccess:    document.getElementById("order-success"),
  toast:           document.getElementById("toast"),
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function getImages(p) {
  return Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
}

function deriveCategories() {
  const seen = new Set();
  categories = ["All"];
  products.forEach(p => {
    if (p.category && !seen.has(p.category)) {
      seen.add(p.category);
      categories.push(p.category);
    }
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// RENDERING
// ═════════════════════════════════════════════════════════════════════════════

function renderCategories() {
  els.categoryList.innerHTML = categories
    .map(cat => `
      <button
        class="category-chip${cat === activeCategory ? " active" : ""}"
        data-category="${cat}"
      >${cat}</button>
    `)
    .join("");
}

function buildStars(rating) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="star${i < Math.round(rating) ? " filled" : ""}" aria-hidden="true">★</span>`
  ).join("");
}

function buildProductCard(p) {
  const stars       = buildStars(p.rating || 0);
  const oldPriceTag = p.oldPrice
    ? `<span class="old-price">$${Number(p.oldPrice).toFixed(2)}</span>`
    : "";
  const imgs          = getImages(p);
  const thumb         = imgs[0] || "https://placehold.co/600x600/141414/333333?text=Photo+Soon";
  const multiImg      = imgs.length > 1;
  const available     = getAvailableCount(p);
  const soldOut       = available === 0;
  const stockLabel    = available === null
    ? ""
    : `<span class="product-stock${soldOut ? " sold-out" : ""}">${soldOut ? "Sold out" : `${available} available`}</span>`;

  return `
    <article class="product-card" data-id="${p._docId}">
      <div class="product-img-wrap">
        ${multiImg ? `<span class="product-img-count" aria-hidden="true">${imgs.length}</span>` : ""}
        <img
          src="${thumb}"
          alt="${p.name}"
          class="product-img"
          loading="lazy"
          onerror="this.src='https://placehold.co/600x600/141414/333333?text=Photo+Soon'"
        >
      </div>
      <div class="product-body">
        <h3 class="product-name">${p.name}</h3>
        <p class="product-cat">${p.category || ""}</p>
        <div class="product-rating" aria-label="Rating: ${p.rating} out of 5">
          <span class="stars" aria-hidden="true">${stars}</span>
          <span class="review-count">(${p.reviewCount || 0})</span>
        </div>
        <div class="product-footer">
          <div class="price-group">
            <span class="price">$${Number(p.price).toFixed(2)}</span>
            ${oldPriceTag}
          </div>
          ${stockLabel}
          <button
            class="btn btn-primary btn-sm add-to-cart"
            data-id="${p._docId}"
            aria-label="Add ${p.name} to cart"
            ${soldOut ? "disabled" : ""}
          >${soldOut ? "Sold Out" : "Add"}</button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const filtered = getFilteredProducts();

  if (filtered.length === 0) {
    els.productGrid.innerHTML = `
      <div class="no-results">
        <p class="no-results-icon">○</p>
        <p>No prints found.</p>
        <button class="btn btn-ghost btn-sm" id="clear-filters-btn">Clear filters</button>
      </div>
    `;
    document.getElementById("clear-filters-btn")?.addEventListener("click", clearFilters);
    return;
  }

  els.productGrid.innerHTML = filtered.map(buildProductCard).join("");
}

function renderFeatured() {
  const featured = products.filter(p => p.featured);
  els.featuredGrid.innerHTML = featured.map(buildProductCard).join("");
}

function getFilteredProducts() {
  const q = searchQuery.toLowerCase().trim();
  return products.filter(p => {
    const matchCat    = activeCategory === "All" || p.category === activeCategory;
    const matchSearch = !q
      || p.name?.toLowerCase().includes(q)
      || p.category?.toLowerCase().includes(q)
      || p.description?.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });
}

function clearFilters() {
  activeCategory = "All";
  searchQuery    = "";
  els.searchInput.value = "";
  renderCategories();
  renderProducts();
}

function showGridLoading() {
  const loading = `<div class="admin-state" style="grid-column:1/-1"><p style="color:var(--text-muted)">Loading…</p></div>`;
  els.featuredGrid.innerHTML = loading;
  els.productGrid.innerHTML  = loading;
}


// ═════════════════════════════════════════════════════════════════════════════
// FIRESTORE — PRODUCTS
// ═════════════════════════════════════════════════════════════════════════════

function subscribeToProducts() {
  showGridLoading();
  const q = query(collection(db, "products"), orderBy("name"));
  onSnapshot(q, snapshot => {
    products = snapshot.docs.map(d => normalizeProduct({ _docId: d.id, ...d.data() }, d.id));
    syncCartWithProducts();
    deriveCategories();
    renderCategories();
    renderFeatured();
    renderProducts();
  }, err => {
    console.error("Failed to load products:", err);
    els.productGrid.innerHTML = `<div class="no-results"><p>Could not load products.</p></div>`;
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// CART
// ═════════════════════════════════════════════════════════════════════════════

function addToCart(docId) {
  const product = products.find(p => p._docId === docId);
  if (!product) return;
  const available = getAvailableCount(product);

  const existing = cart.find(item => item.id === docId);
  const nextQty = (existing?.qty || 0) + 1;
  if (available !== null && nextQty > available) {
    showToast(available === 0 ? `"${product.name}" is sold out` : `Only ${available} "${product.name}" available`);
    return;
  }

  if (existing) {
    existing.qty = nextQty;
  } else {
    const imgs = getImages(product);
    cart.push({
      id:       docId,
      productId: product.productId || "",
      name:     product.name,
      category: product.category,
      price:    Number(product.price),
      image:    imgs[0] || "",
      qty:      1,
    });
  }

  persistCart();
  updateCartBadge();
  showToast(`"${product.name}" added`);
}

function removeFromCart(docId) {
  cart = cart.filter(item => item.id !== docId);
  persistCart();
  updateCartBadge();
  renderCartItems();
}

function changeQty(docId, delta) {
  const item = cart.find(i => i.id === docId);
  if (!item) return;
  const nextQty = item.qty + delta;
  if (nextQty <= 0) { removeFromCart(docId); return; }

  const product = products.find(p => p._docId === docId);
  const available = getAvailableCount(product);
  if (delta > 0 && available !== null && nextQty > available) {
    showToast(available === 0 ? `"${item.name}" is sold out` : `Only ${available} "${item.name}" available`);
    return;
  }

  item.qty = nextQty;
  persistCart();
  updateCartBadge();
  renderCartItems();
}

function syncCartWithProducts() {
  let changed = false;

  cart = cart.filter(item => {
    const product = products.find(p => p._docId === item.id);
    if (!product) {
      changed = true;
      return false;
    }

    const nextImage = getImages(product)[0] || "";
    if (
      item.name !== product.name
      || item.category !== product.category
      || item.price !== Number(product.price)
      || item.image !== nextImage
      || item.productId !== (product.productId || "")
    ) {
      item.name = product.name;
      item.category = product.category;
      item.price = Number(product.price);
      item.image = nextImage;
      item.productId = product.productId || "";
      changed = true;
    }

    return true;
  });

  if (changed) {
    persistCart();
    updateCartBadge();
    if (els.cartDrawer.classList.contains("open")) renderCartItems();
  }
}

function persistCart() {
  localStorage.setItem("formamaker_cart", JSON.stringify(cart));
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function cartItemCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function updateCartBadge() {
  const count = cartItemCount();
  els.cartCount.textContent = count || "";
  els.cartCount.classList.toggle("visible", count > 0);
  document.getElementById("cart-btn").setAttribute("aria-label", `Open cart (${count} items)`);
}

function renderCartItems() {
  if (cart.length === 0) {
    els.cartEmpty.style.display       = "flex";
    els.cartFormSection.style.display = "none";
    els.cartItems.innerHTML           = "";
    els.cartSubtotal.textContent      = "$0.00";
    return;
  }

  els.cartEmpty.style.display       = "none";
  els.cartFormSection.style.display = "block";

  els.cartItems.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${item.id}">
      <img
        src="${item.image}"
        alt="${item.name}"
        class="cart-item-img"
        onerror="this.src='https://placehold.co/80x80/1E1E1E/444444?text=?'"
      >
      <div class="cart-item-info">
        <p class="cart-item-name">${item.name}</p>
        <p class="cart-item-unit-price">$${item.price.toFixed(2)} each</p>
        <div class="cart-qty-controls">
          <button class="qty-btn" data-id="${item.id}" data-delta="-1" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" data-id="${item.id}" data-delta="1" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div class="cart-item-right">
        <span class="cart-item-line-total">$${(item.price * item.qty).toFixed(2)}</span>
        <button class="remove-btn" data-id="${item.id}" aria-label="Remove ${item.name}">✕</button>
      </div>
    </div>
  `).join("");

  els.cartSubtotal.textContent = `$${cartTotal().toFixed(2)}`;
}


// ─── Lightbox ─────────────────────────────────────────────────────────────────

const lbState = { images: [], index: 0, docId: null };

function openLightbox(docId) {
  const p = products.find(p => p._docId === docId);
  if (!p) return;

  lbState.images = getImages(p);
  lbState.index  = 0;
  lbState.docId  = docId;

  document.getElementById("lightbox-cat").textContent   = p.category || "";
  document.getElementById("lightbox-name").textContent  = p.name;
  document.getElementById("lightbox-desc").textContent  = p.description || "";
  document.getElementById("lightbox-price").textContent = `$${Number(p.price).toFixed(2)}`;
  document.getElementById("lightbox-old-price").textContent = p.oldPrice ? `$${Number(p.oldPrice).toFixed(2)}` : "";
  document.getElementById("lightbox-rating").innerHTML  =
    buildStars(p.rating || 0) + `<span class="review-count">(${p.reviewCount || 0})</span>`;
  const addBtn = document.getElementById("lightbox-add-btn");
  const available = getAvailableCount(p);
  const soldOut = available === 0;
  addBtn.dataset.id = docId;
  addBtn.disabled = soldOut;
  addBtn.textContent = soldOut ? "Sold Out" : "Add to Cart";

  setLightboxImage(0);

  const overlay = document.getElementById("lightbox-overlay");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
  document.getElementById("lightbox-close").focus();
}

function setLightboxImage(index) {
  const { images } = lbState;
  lbState.index    = index;
  const img        = document.getElementById("lightbox-img");
  img.src          = images[index] || "";

  const multi = images.length > 1;
  document.getElementById("lightbox-prev").style.display = multi ? "" : "none";
  document.getElementById("lightbox-next").style.display = multi ? "" : "none";

  const dotsEl = document.getElementById("lightbox-dots");
  if (multi) {
    dotsEl.innerHTML = images.map((_, i) =>
      `<span class="lb-dot${i === index ? " active" : ""}" data-index="${i}" aria-label="Image ${i + 1}"></span>`
    ).join("");
    dotsEl.style.display = "";
  } else {
    dotsEl.style.display = "none";
  }
}

function closeLightbox() {
  const overlay = document.getElementById("lightbox-overlay");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}


// ─── Cart drawer ──────────────────────────────────────────────────────────────

function openCart() {
  renderCartItems();
  els.cartDrawer.classList.add("open");
  els.cartOverlay.classList.add("visible");
  document.body.classList.add("no-scroll");
  els.orderSuccess.style.display = "none";
  els.orderForm.style.display    = "block";
}

function closeCart() {
  els.cartDrawer.classList.remove("open");
  els.cartOverlay.classList.remove("visible");
  document.body.classList.remove("no-scroll");
}


// ═════════════════════════════════════════════════════════════════════════════
// ORDER FORM
// ═════════════════════════════════════════════════════════════════════════════

async function handleOrderSubmit(e) {
  e.preventDefault();
  clearFormErrors();

  const customerName    = document.getElementById("field-name").value.trim();
  const productDetails  = document.getElementById("field-product").value.trim();
  const deliveryDetails = document.getElementById("field-delivery").value.trim();

  let valid = true;
  if (!customerName)    { markFieldError("field-name",     "Your name is required."); valid = false; }
  if (!productDetails)  { markFieldError("field-product",  "Please describe what you'd like."); valid = false; }
  if (!deliveryDetails) { markFieldError("field-delivery", "Please add delivery details."); valid = false; }
  if (cart.length === 0) {
    showBannerError("Please add at least one item to your cart before sending a request.");
    valid = false;
  }
  for (const item of cart) {
    const product = products.find(p => p._docId === item.id);
    const available = getAvailableCount(product);
    if (available !== null && item.qty > available) {
      showBannerError(`${item.name} only has ${available} available right now.`);
      valid = false;
      break;
    }
  }
  if (!valid) return;

  const orderData = {
    customerName,
    productDetails,
    deliveryDetails,
    items: cart.map(item => ({
      id:       item.id,
      productId: item.productId,
      name:     item.name,
      category: item.category,
      price:    item.price,
      qty:      item.qty,
      subtotal: parseFloat((item.price * item.qty).toFixed(2)),
    })),
    total:  parseFloat(cartTotal().toFixed(2)),
    status: "new",
  };

  const submitBtn = document.getElementById("submit-order-btn");
  submitBtn.disabled    = true;
  submitBtn.textContent = "Sending…";

  try {
    await createOrderWithInventory(orderData);

    cart = [];
    persistCart();
    updateCartBadge();

    els.orderForm.style.display    = "none";
    els.orderSuccess.style.display = "flex";

  } catch (err) {
    console.error("Firestore submission error:", err);
    showBannerError(err.message || "Something went wrong. Please try again or contact us directly.");
    submitBtn.disabled    = false;
    submitBtn.textContent = "Send Order Request";
  }
}

function clearFormErrors() {
  document.querySelectorAll(".field-error-msg").forEach(el => el.remove());
  document.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));
  document.getElementById("form-banner-error")?.remove();
}

function markFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  field.classList.add("input-error");
  field.setAttribute("aria-invalid", "true");
  const msg = document.createElement("span");
  msg.className   = "field-error-msg";
  msg.textContent = message;
  field.insertAdjacentElement("afterend", msg);
}

function showBannerError(message) {
  document.getElementById("form-banner-error")?.remove();
  const banner = document.createElement("div");
  banner.id          = "form-banner-error";
  banner.className   = "form-banner-error";
  banner.textContent = message;
  els.orderForm.prepend(banner);
}


// ═════════════════════════════════════════════════════════════════════════════
// TOAST
// ═════════════════════════════════════════════════════════════════════════════

let toastTimer = null;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}


// ═════════════════════════════════════════════════════════════════════════════
// EVENTS
// ═════════════════════════════════════════════════════════════════════════════

function bindEvents() {

  // Cart open / close
  document.getElementById("cart-btn").addEventListener("click", openCart);
  document.getElementById("cart-close-btn").addEventListener("click", closeCart);
  els.cartOverlay.addEventListener("click", closeCart);

  // Category chips
  els.categoryList.addEventListener("click", e => {
    const chip = e.target.closest(".category-chip");
    if (!chip) return;
    activeCategory = chip.dataset.category;
    renderCategories();
    renderProducts();
    document.getElementById("products-section")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Search
  els.searchInput.addEventListener("input", () => {
    searchQuery = els.searchInput.value;
    renderProducts();
  });
  els.searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      els.searchInput.value = "";
      searchQuery = "";
      renderProducts();
      els.searchInput.blur();
    }
  });

  // Add to cart (delegated — uses string docId)
  document.addEventListener("click", e => {
    const btn = e.target.closest(".add-to-cart");
    if (!btn) return;
    addToCart(btn.dataset.id);
  });

  // Lightbox — open on product image click
  document.addEventListener("click", e => {
    const wrap = e.target.closest(".product-img-wrap");
    if (!wrap) return;
    const card = wrap.closest(".product-card");
    if (!card) return;
    openLightbox(card.dataset.id);
  });

  // Lightbox — close
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("lightbox-overlay")) closeLightbox();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeLightbox(); return; }
    if (!document.getElementById("lightbox-overlay").classList.contains("open")) return;
    if (e.key === "ArrowLeft")  setLightboxImage((lbState.index - 1 + lbState.images.length) % lbState.images.length);
    if (e.key === "ArrowRight") setLightboxImage((lbState.index + 1) % lbState.images.length);
  });

  // Lightbox — prev / next / dots
  document.getElementById("lightbox-prev").addEventListener("click", () =>
    setLightboxImage((lbState.index - 1 + lbState.images.length) % lbState.images.length)
  );
  document.getElementById("lightbox-next").addEventListener("click", () =>
    setLightboxImage((lbState.index + 1) % lbState.images.length)
  );
  document.getElementById("lightbox-dots").addEventListener("click", e => {
    const dot = e.target.closest(".lb-dot");
    if (dot) setLightboxImage(parseInt(dot.dataset.index, 10));
  });

  // Lightbox — add to cart (string docId)
  document.getElementById("lightbox-add-btn").addEventListener("click", e => {
    addToCart(e.currentTarget.dataset.id);
    closeLightbox();
  });

  // Cart item qty / remove (delegated — string docId)
  els.cartItems.addEventListener("click", e => {
    const qtyBtn    = e.target.closest(".qty-btn");
    const removeBtn = e.target.closest(".remove-btn");
    if (qtyBtn)    changeQty(qtyBtn.dataset.id, parseInt(qtyBtn.dataset.delta, 10));
    if (removeBtn) removeFromCart(removeBtn.dataset.id);
  });

  // Order form
  els.orderForm.addEventListener("submit", handleOrderSubmit);
  els.orderForm.addEventListener("focusin", e => {
    if (e.target.matches("input, textarea")) {
      e.target.classList.remove("input-error");
      e.target.setAttribute("aria-invalid", "false");
      if (e.target.nextElementSibling?.classList.contains("field-error-msg")) {
        e.target.nextElementSibling.remove();
      }
    }
  });

  // Hero CTA
  document.getElementById("hero-shop-btn")?.addEventListener("click", () =>
    document.getElementById("products-section").scrollIntoView({ behavior: "smooth" })
  );

  // Mobile hamburger
  document.getElementById("hamburger-btn")?.addEventListener("click", () => {
    const menu = document.getElementById("mobile-menu");
    const open = menu.classList.toggle("open");
    document.getElementById("hamburger-btn").setAttribute("aria-expanded", open);
  });
  document.getElementById("mobile-menu")?.querySelectorAll("a").forEach(a =>
    a.addEventListener("click", () =>
      document.getElementById("mobile-menu").classList.remove("open")
    )
  );

  // "Browse More" after success
  document.getElementById("new-order-btn")?.addEventListener("click", () => {
    els.orderSuccess.style.display = "none";
    els.orderForm.style.display    = "block";
    els.orderForm.reset();
    closeCart();
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════

function init() {
  updateCartBadge();
  bindEvents();
  subscribeToProducts();
}

init();
