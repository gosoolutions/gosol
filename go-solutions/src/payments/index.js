const sandbox = require('./sandbox');
const hosted = require('./hosted-card');
const paypal = require('./paypal');
const { sandboxOn } = require('../config');

// Decides where the customer goes after placing an order.
// card, alipay and wechat all go through the hosted payment page provider.
function providerFor(method) {
  if (method === 'bank') return null;
  if (method === 'paypal') return process.env.PAYPAL_CLIENT_ID ? paypal : (sandboxOn ? sandbox : null);
  if (process.env.PAYMENT_PROVIDER === 'hosted') return hosted;
  return sandboxOn ? sandbox : null;
}

async function start(order) {
  const provider = providerFor(order.payment_method);
  if (!provider) return { type: 'order' }; // bank transfer: show instructions on the order page
  return provider.start(order);
}

// Payment routes need the raw request body for signature checks,
// so they are mounted before the JSON body parser.
function mount(app) {
  if (sandboxOn) sandbox.mount(app);
  hosted.mount(app);
  paypal.mount(app);
}

module.exports = { start, mount };
