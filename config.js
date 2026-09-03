require('dotenv').config();
const path = require('path');

const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Our Business';
const BUSINESS_DESC = process.env.BUSINESS_DESC || 'We provide excellent services.';
const BUSINESS_HOURS = process.env.BUSINESS_HOURS || 'Mon - Sat: 9:00 AM - 7:00 PM';
const BUSINESS_LOCATION = process.env.BUSINESS_LOCATION || 'India';
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || 'contact@business.com';
const BUSINESS_WEBSITE = process.env.BUSINESS_WEBSITE || 'https://business.com';
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || '';
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

// Media folder path — place images/docs here to send as replies
const MEDIA_DIR = path.join(__dirname, 'media');

// Keyword-based reply mapping
// Values can be: string (text only) or object { text, media }
const KEYWORD_REPLIES = {
  // --- Greetings ---
  'hi': `Hello! Welcome to ${BUSINESS_NAME}! 👋\nHow can we help you today?`,
  'hello': `Hey there! Thanks for reaching out to ${BUSINESS_NAME}! 😊\nHow can we assist you?`,
  'hey': `Hi! Welcome to ${BUSINESS_NAME}!\nWhat can we do for you?`,
  'good morning': `Good morning! ☀️ Welcome to ${BUSINESS_NAME}!\nHow may we help you?`,
  'good evening': `Good evening! 🌙 Welcome to ${BUSINESS_NAME}!\nHow can we assist you?`,
  'good night': `Good night! 🌙 Have a great rest!\nFeel free to message us anytime.`,
  'how are you': `We're doing great, thanks for asking! 😊\nHow can we help you today?`,
  'who are you': `We're ${BUSINESS_NAME} — ${BUSINESS_DESC}\n\nHow can we help you?`,

  // --- Services ---
  'services': `📋 *Our Services at ${BUSINESS_NAME}:*\n\n${BUSINESS_DESC}\n\nFeel free to ask about any specific service!`,
  'offer': `🎯 *What We Offer:*\n\n${BUSINESS_DESC}\n\nWant to know more about a specific service?`,
  'what do you do': `We are ${BUSINESS_NAME}!\n\n${BUSINESS_DESC}\n\nLet us know how we can help you!`,
  'service': `📋 *Our Services:*\n\n${BUSINESS_DESC}\n\nType *help* to see all available options.`,
  'solution': `💡 *Our Solutions:*\n\n${BUSINESS_DESC}\n\nWant a custom solution? Contact us!`,
  'help': `🤝 *How can we help you?*\n\nYou can ask about:\n• *Services* — what we offer\n• *Price* — pricing info\n• *Hours* — business timing\n• *Location* — where we are\n• *Portfolio* — our work\n• *Contact* — reach us directly\n\nJust type any keyword!`,

  // --- Pricing ---
  'price': `💰 *Pricing Information:*\n\nOur pricing varies based on your requirements.\n\nPlease share your project details and we'll provide a custom quote!\n\n📧 Email: ${BUSINESS_EMAIL}\n🌐 Website: ${BUSINESS_WEBSITE}`,
  'pricing': `💰 *Pricing Information:*\n\nWe offer competitive rates for all our services.\n\nShare your requirements for a custom quote!\n📧 ${BUSINESS_EMAIL}`,
  'cost': `💰 *Cost Details:*\n\nWe offer competitive pricing tailored to your needs.\n\nReach out to us for a free consultation and quote!\n\n📧 ${BUSINESS_EMAIL}`,
  'quote': `📝 *Get a Free Quote:*\n\nShare your requirements and we'll get back to you with a detailed quote.\n\n📧 Email: ${BUSINESS_EMAIL}\n🌐 Web: ${BUSINESS_WEBSITE}`,
  'cheap': `💡 We offer solutions for every budget!\n\nContact us for affordable options:\n📧 ${BUSINESS_EMAIL}`,
  'affordable': `💡 Quality doesn't have to be expensive!\n\nLet's discuss your budget and find the right solution.\n📧 ${BUSINESS_EMAIL}`,
  'budget': `💰 *Budget-Friendly Options:*\n\nWe work with all budgets!\n\nTell us your budget and we'll find the right solution.\n📧 ${BUSINESS_EMAIL}`,
  'free': `🎁 *Free Consultation:*\n\nWe offer a FREE initial consultation!\n\n📞 WhatsApp us or 📧 Email: ${BUSINESS_EMAIL}`,

  // --- Business Hours ---
  'hours': `🕐 *Business Hours:*\n\n${BUSINESS_HOURS}\n\nWe'll respond as soon as possible during business hours!`,
  'time': `🕐 *Our Timing:*\n\n${BUSINESS_HOURS}\n\nFeel free to message us anytime — we'll reply during business hours!`,
  'open': `🕐 *Are We Open?*\n\nYes! Our hours are:\n${BUSINESS_HOURS}`,
  'available': `✅ We're available during:\n${BUSINESS_HOURS}\n\nLeave us a message anytime!`,
  'schedule': `📅 *Our Schedule:*\n\n${BUSINESS_HOURS}`,

  // --- Location ---
  'location': `📍 *Our Location:*\n\n${BUSINESS_LOCATION}\n\nVisit us or reach out for directions!`,
  'where': `📍 *Where We Are:*\n\n${BUSINESS_LOCATION}\n\nFeel free to visit us!`,
  'address': `📍 *Our Address:*\n\n${BUSINESS_LOCATION}\n\nGoogle Maps link available on request!`,
  'directions': `🗺️ *Directions:*\n\nWe're located at:\n${BUSINESS_LOCATION}\n\nNeed exact directions? Contact us!`,
  'visit': `📍 *Visit Us:*\n\n${BUSINESS_LOCATION}\n\nWe'd love to see you!`,

  // --- Contact ---
  'contact': `📞 *Contact Us:*\n\n📧 Email: ${BUSINESS_EMAIL}\n🌐 Website: ${BUSINESS_WEBSITE}\n📱 WhatsApp: You're already here! 😄\n\n${BUSINESS_HOURS}`,
  'phone': `📱 *Phone/WhatsApp:*\n\nYou're messaging us on WhatsApp!\n\nFor other options:\n📧 Email: ${BUSINESS_EMAIL}\n🌐 Website: ${BUSINESS_WEBSITE}`,
  'email': `📧 *Email Us:*\n\n${BUSINESS_EMAIL}\n\nWe'll respond within 24 hours!`,
  'website': `🌐 *Visit Our Website:*\n\n${BUSINESS_WEBSITE}\n\nExplore our services and portfolio!`,
  'call': `📱 *Give Us a Call:*\n\nYou can WhatsApp us here directly!\n\nOr email: ${BUSINESS_EMAIL}`,

  // --- Portfolio / Work ---
  'portfolio': `📂 *Our Work:*\n\nCheck out our portfolio on our website:\n🌐 ${BUSINESS_WEBSITE}\n\nWe'd love to work on your project too!`,
  'work': `📂 *Our Portfolio:*\n\n${BUSINESS_WEBSITE}\n\nSee what we've built for our clients!`,
  'project': `📂 *Our Projects:*\n\nWe've worked on many exciting projects!\n\nCheck them out: ${BUSINESS_WEBSITE}`,
  'client': `🤝 *Our Clients:*\n\nWe've worked with amazing clients.\n\nSee testimonials on: ${BUSINESS_WEBSITE}`,

  // --- Feedback ---
  'review': `⭐ *We Value Your Feedback!*\n\nYour reviews help us improve.\n\nShare your experience with us!`,
  'feedback': `📝 *Your Feedback Matters!*\n\nWe'd love to hear from you.\n\nShare your thoughts and suggestions!`,
  'complaint': `😔 *We're Sorry!*\n\nPlease tell us what went wrong.\n\nWe'll do our best to fix it immediately.\n📧 ${BUSINESS_EMAIL}`,
  'problem': `🔧 *Let's Fix This!*\n\nPlease describe your issue.\n\nOur team will get back to you ASAP.\n📧 ${BUSINESS_EMAIL}`,

  // --- Offers / Deals ---
  'offer': `🎉 *Special Offer!*\n\nWe have exciting deals running!\n\nContact us for the latest offers:\n📧 ${BUSINESS_EMAIL}`,
  'discount': `🏷️ *Discounts Available!*\n\nAsk us about current promotions!\n\n📧 ${BUSINESS_EMAIL}`,
  'deal': `🔥 *Hot Deals!*\n\nCheck our website for latest deals:\n🌐 ${BUSINESS_WEBSITE}`,

  // --- Payment ---
  'payment': `💳 *Payment Methods:*\n\nWe accept:\n• UPI\n• Bank Transfer\n• PayPal\n• Cash\n\nContact us for payment details!`,
  'pay': `💳 *Payment Info:*\n\nUPI / Bank Transfer / PayPal accepted.\n\nContact us for details:\n📧 ${BUSINESS_EMAIL}`,

  // --- Thanks ---
  'thanks': `You're welcome! 😊\n\nIs there anything else we can help you with?`,
  'thank you': `Thank you! 🙏\n\nGlad we could help. Let us know if you need anything else!`,
  'ty': `You're welcome! 😊\n\nWe're here if you need anything!`,

  // --- Bye ---
  'bye': `Goodbye! 👋\n\nThanks for reaching out to ${BUSINESS_NAME}. We hope to hear from you again!`,
  'goodbye': `Take care! 👋\n\nHave a great day! We're here whenever you need us.`,
  'see you': `See you soon! 👋\n\nHave a wonderful day!`,
  'take care': `You too! Take care! 😊\n\nCome back anytime!`,
};

// Media replies — map keywords to files in the /media folder
// Place your images/docs in the media/ folder and reference them here
const MEDIA_REPLIES = {
  // 'brochure': { file: 'brochure.pdf', caption: '📄 Here\'s our brochure!' },
  // 'logo': { file: 'logo.png', caption: '🎨 This is our logo!' },
  // Uncomment and add your own media files above
};

// Default reply when no keyword matches
const DEFAULT_REPLY = `Thanks for messaging ${BUSINESS_NAME}! 🙏

We've received your message and will get back to you soon.

Meanwhile, you can ask about:
• *Services* — what we offer
• *Price* — pricing info
• *Hours* — business timing
• *Location* — where we are
• *Contact* — reach us directly
• *Portfolio* — our work

Just type any keyword above!`;

module.exports = {
  KEYWORD_REPLIES,
  MEDIA_REPLIES,
  DEFAULT_REPLY,
  BUSINESS_NAME,
  MEDIA_DIR,
  ADMIN_NUMBERS,
};
