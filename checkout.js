"use strict";

const checkoutElements = {
  list: document.querySelector("#checkout-items"),
  empty: document.querySelector("#checkout-empty"),
  subtotal: document.querySelector("#checkout-subtotal"),
  itemCount: document.querySelector("#checkout-item-count"),
  clear: document.querySelector("#clear-cart"),
  form: document.querySelector("#checkout-form"),
  submit: document.querySelector("#checkout-submit"),
  status: document.querySelector("#checkout-status"),
  endpointNotice: document.querySelector("#endpoint-notice"),
  orderSummary: document.querySelector("#order-summary-field"),
  orderReference: document.querySelector("#order-reference-field"),
  cartSubtotal: document.querySelector("#cart-subtotal-field"),
  success: document.querySelector("#checkout-success")
};

const checkoutCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const orderReference = `SR-${Date.now().toString(36).toUpperCase()}`;

function getCheckoutEndpoint() {
  const endpoint = CheckoutConfig.formspreeEndpoint;
  return typeof endpoint === "string" && /^https:\/\/formspree\.io\/f\/[a-z0-9]+$/iu.test(endpoint.trim())
    ? endpoint.trim()
    : null;
}

function checkoutElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function formatPrice(price) {
  return Number.isFinite(price) ? checkoutCurrency.format(price) : "Price on request";
}

function createCheckoutItem(item) {
  const row = checkoutElement("li", "checkout-item");
  const visual = checkoutElement("div", `checkout-item-image ${item.type === "book" ? "checkout-book-image" : ""}`);
  if (item.image) {
    const image = document.createElement("img");
    image.src = item.image;
    image.alt = item.imageAlt;
    visual.append(image);
  } else {
    visual.append(checkoutElement("span", "image-placeholder"));
  }

  const details = checkoutElement("div", "checkout-item-details");
  details.append(checkoutElement("p", "card-catalog-number", item.catalogNumber || (item.type === "book" ? "Library record" : "Sale record")));
  details.append(checkoutElement("h3", "", item.name));
  if (item.subtitle) details.append(checkoutElement("p", "", item.subtitle));

  const controls = checkoutElement("div", "checkout-item-controls");
  controls.append(checkoutElement("strong", "", formatPrice(item.priceUsd)));
  const remove = checkoutElement("button", "remove-cart-item", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => CartStore.remove(item.key));
  controls.append(remove);
  row.append(visual, details, controls);
  return row;
}

function createOrderSummary(items) {
  const lines = items.map((item, index) => `${index + 1}. ${item.catalogNumber || item.id} — ${item.name} — ${formatPrice(item.priceUsd)}`);
  return [
    `Order request: ${orderReference}`,
    ...lines,
    `Catalog subtotal: ${formatPrice(CartStore.subtotal(items))}`,
    "Shipping: To be calculated and confirmed before payment"
  ].join("\n");
}

function renderCheckout() {
  const items = CartStore.readItems();
  const endpoint = getCheckoutEndpoint();
  checkoutElements.list.replaceChildren(...items.map(createCheckoutItem));
  checkoutElements.empty.hidden = items.length > 0;
  checkoutElements.list.hidden = items.length === 0;
  checkoutElements.clear.hidden = items.length === 0;
  checkoutElements.itemCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  checkoutElements.subtotal.textContent = formatPrice(CartStore.subtotal(items));
  checkoutElements.orderSummary.value = createOrderSummary(items);
  checkoutElements.orderReference.value = orderReference;
  checkoutElements.cartSubtotal.value = formatPrice(CartStore.subtotal(items));
  checkoutElements.submit.disabled = items.length === 0 || !endpoint;
  checkoutElements.endpointNotice.hidden = Boolean(endpoint);
}

async function submitCheckout(event) {
  event.preventDefault();
  const endpoint = getCheckoutEndpoint();
  const items = CartStore.readItems();
  if (!endpoint || !items.length || !checkoutElements.form.reportValidity()) return;

  checkoutElements.submit.disabled = true;
  checkoutElements.submit.textContent = "Sending request…";
  checkoutElements.status.textContent = "Sending your checkout request securely.";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: new FormData(checkoutElements.form),
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Checkout request failed with status ${response.status}`);
    CartStore.clear();
    checkoutElements.form.reset();
    checkoutElements.form.hidden = true;
    checkoutElements.success.hidden = false;
    checkoutElements.success.focus();
  } catch (error) {
    console.error("Checkout request could not be sent.", error);
    checkoutElements.status.textContent = "The request could not be sent. Please try again later.";
    checkoutElements.submit.disabled = false;
    checkoutElements.submit.textContent = "Send checkout request";
  }
}

checkoutElements.clear.addEventListener("click", () => CartStore.clear());
checkoutElements.form.addEventListener("submit", submitCheckout);
window.addEventListener("cart:change", renderCheckout);
renderCheckout();
