// ─────────────────────────────────────────────────────────────────────────────
// app.js — FormaMaker application logic
// Products are loaded from Firestore in real-time.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./firebase-config.js";
import {
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
let activeCategory = "All";
let searchQuery    = "";


// ─── DOM refs ─────────────────────────────────────────────────────────────────

const els = {
  categoryList:  document.getElementById("category-list"),
  productGrid:   document.getElementById("product-grid"),
  featuredGrid:  document.getElementById("featured-grid"),
  searchInput:   document.getElementById("search-input"),
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

function openEbayUrl(url) {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
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
  const hasEbay       = !!p.ebayUrl;

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
            class="btn btn-primary btn-sm buy-at-ebay"
            data-id="${p._docId}"
            data-ebay-url="${p.ebayUrl || ""}"
            aria-label="Buy ${p.name} at eBay"
            ${!hasEbay ? "disabled" : ""}
          >Buy at eBay</button>
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
    deriveCategories();
    renderCategories();
    renderFeatured();
    renderProducts();
  }, err => {
    console.error("Failed to load products:", err);
    els.productGrid.innerHTML = `<div class="no-results"><p>Could not load products.</p></div>`;
  });
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
  addBtn.dataset.id      = docId;
  addBtn.dataset.ebayUrl = p.ebayUrl || "";
  addBtn.disabled        = !p.ebayUrl;
  addBtn.textContent     = "Buy at eBay";

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


// ═════════════════════════════════════════════════════════════════════════════
// EVENTS
// ═════════════════════════════════════════════════════════════════════════════

function bindEvents() {

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

  // Buy at eBay (delegated)
  document.addEventListener("click", e => {
    const btn = e.target.closest(".buy-at-ebay");
    if (!btn) return;
    openEbayUrl(btn.dataset.ebayUrl);
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

  // Lightbox — Buy at eBay
  document.getElementById("lightbox-add-btn").addEventListener("click", e => {
    openEbayUrl(e.currentTarget.dataset.ebayUrl);
    closeLightbox();
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
}


// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════

function init() {
  bindEvents();
  subscribeToProducts();
}

init();
