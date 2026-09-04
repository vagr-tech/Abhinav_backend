const axios = require("axios");

// ─── Token Cache ───────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = null;

const getAccessToken = async () => {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  try {
    const response = await axios.post(
      "https://accounts.zoho.in/oauth/v2/token",
      null,
      {
        params: {
          refresh_token: process.env.ZOHO_REFRESH_TOKEN,
          client_id: process.env.ZOHO_CLIENT_ID,
          client_secret: process.env.ZOHO_CLIENT_SECRET,
          grant_type: "refresh_token",
        },
      },
    );

    const data = response.data;

    if (data.error) throw new Error(`Zoho token error: ${data.error}`);
    if (!data.access_token)
      throw new Error(
        `No access token returned. Response: ${JSON.stringify(data)}`,
      );

    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    console.log("✅ Zoho access token refreshed successfully");
    return cachedToken;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("❌ ZOHO TOKEN ERROR:", JSON.stringify(detail));
    throw new Error(
      `Failed to get Zoho access token: ${JSON.stringify(detail)}`,
    );
  }
};

// ─── Analytics Token Cache (separate from Books token) ─────
let cachedAnalyticsToken = null;
let analyticsTokenExpiresAt = null;

const getAnalyticsAccessToken = async () => {
  if (
    cachedAnalyticsToken &&
    analyticsTokenExpiresAt &&
    Date.now() < analyticsTokenExpiresAt - 60000
  ) {
    return cachedAnalyticsToken;
  }

  try {
    const response = await axios.post(
      "https://accounts.zoho.in/oauth/v2/token",
      null,
      {
        params: {
          refresh_token: process.env.ZOHO_ANALYTICS_REFRESH_TOKEN,
          client_id: process.env.ZOHO_SELF_CLIENT_ID,
          client_secret: process.env.ZOHO_SELF_CLIENT_SECRET,
          grant_type: "refresh_token",
        },
      },
    );

    const data = response.data;

    if (data.error)
      throw new Error(`Zoho Analytics token error: ${data.error}`);
    if (!data.access_token)
      throw new Error(
        `No Analytics access token returned. Response: ${JSON.stringify(data)}`,
      );

    cachedAnalyticsToken = data.access_token;
    analyticsTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    console.log("✅ Zoho Analytics access token refreshed successfully");
    return cachedAnalyticsToken;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("❌ ZOHO ANALYTICS TOKEN ERROR:", JSON.stringify(detail));
    throw new Error(
      `Failed to get Zoho Analytics access token: ${JSON.stringify(detail)}`,
    );
  }
};

// ─── Helper: Normalize phone number (last 10 digits only) ──
// Strips +91, spaces, dashes etc. so "+91 98765 43210" and
// "9876543210" are treated as the same number.
const normalizePhone = (phone) => {
  if (!phone) return "";
  const digitsOnly = phone.toString().replace(/\D/g, "");
  return digitsOnly.slice(-10); // last 10 digits
};

// ─── Find Contact by GST Number ────────────────────────────
// Zoho Books stores GST as "gst_no" on the contact object
const findContactByGST = async (gstNumber, accessToken) => {
  if (!gstNumber || gstNumber.trim() === "") return null;

  try {
    const res = await axios.get("https://www.zohoapis.in/books/v3/contacts", {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: {
        organization_id: process.env.ZOHO_ORG_ID,
        gst_no: gstNumber.trim().toUpperCase(),
      },
    });

    const contacts = res.data.contacts || [];

    // ✅ Confirm exact GST match (Zoho may return partial matches)
    const matched = contacts.find(
      (c) => (c.gst_no || "").toUpperCase() === gstNumber.trim().toUpperCase(),
    );

    return matched || null;
  } catch (err) {
    console.error(
      "❌ findContactByGST ERROR:",
      err.response?.data || err.message,
    );
    return null;
  }
};

// ─── Find Contact by Phone Number ──────────────────────────
// Zoho Books contact object usually has "phone" and "mobile" fields.
// We fetch by "phone" search param (Zoho supports it) and then
// confirm by comparing normalized last-10-digit numbers against
// both phone and mobile, since search param alone can be loose.
const findContactByPhone = async (phoneNumber, accessToken) => {
  if (!phoneNumber || phoneNumber.trim() === "") return null;

  const targetPhone = normalizePhone(phoneNumber);
  if (!targetPhone) return null;

  try {
    const res = await axios.get("https://www.zohoapis.in/books/v3/contacts", {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: {
        organization_id: process.env.ZOHO_ORG_ID,
        phone: phoneNumber.trim(),
      },
    });

    const contacts = res.data.contacts || [];

    // ✅ Confirm exact match on phone OR mobile (normalized)
    const matched = contacts.find(
      (c) =>
        normalizePhone(c.phone) === targetPhone ||
        normalizePhone(c.mobile) === targetPhone,
    );

    if (matched) return matched;

    // ⚠️ Fallback: some Zoho orgs don't support "phone" as a filter
    // param and just ignore it (returning all contacts). In that
    // case the .find() above already handles filtering correctly,
    // so if nothing matched here, there's genuinely no match.
    return null;
  } catch (err) {
    console.error(
      "❌ findContactByPhone ERROR:",
      err.response?.data || err.message,
    );
    return null;
  }
};

// ─── Get Shop Sales (GST → Phone → Name) ────────────────────
const getShopSales = async (
  shopName,
  accessToken,
  visitDate,
  gstNumber,
  phoneNumber,
) => {
  const fromDate = visitDate ? new Date(visitDate) : new Date();
  const toDate = new Date(fromDate);
  toDate.setDate(fromDate.getDate() + 7);

  const formatDate = (d) => d.toISOString().split("T")[0];

  try {
    let customer = null;
    let matchType = null;

    // ✅ Step 1: Try GST match first
    if (gstNumber && gstNumber.trim() !== "") {
      customer = await findContactByGST(gstNumber, accessToken);
      if (customer) {
        matchType = "gst";
        console.log(
          `✅ GST match found: ${customer.contact_name} for GST: ${gstNumber}`,
        );
      } else {
        console.warn(`⚠️ No GST match for ${gstNumber}, trying phone`);
      }
    }

    // ✅ Step 2: Fallback to phone number
    if (!customer && phoneNumber && phoneNumber.trim() !== "") {
      customer = await findContactByPhone(phoneNumber, accessToken);
      if (customer) {
        matchType = "phone";
        console.log(
          `✅ Phone match found: ${customer.contact_name} for phone: ${phoneNumber}`,
        );
      } else {
        console.warn(
          `⚠️ No phone match for ${phoneNumber}, falling back to name`,
        );
      }
    }

    // ✅ Step 3: Fallback to name
    if (!customer && shopName) {
      const customerRes = await axios.get(
        "https://www.zohoapis.in/books/v3/contacts",
        {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
          params: {
            organization_id: process.env.ZOHO_ORG_ID,
            contact_name_contains: shopName,
          },
        },
      );
      const customers = customerRes.data.contacts || [];
      customer = customers[0] || null;
      if (customer) matchType = "name";
    }

    if (!customer) {
      return {
        matched: false,
        shop_name: shopName,
        gst_number: gstNumber,
        phone_number: phoneNumber,
      };
    }

    // ✅ Step 4: Fetch invoices for matched customer
    const invoiceRes = await axios.get(
      "https://www.zohoapis.in/books/v3/invoices",
      {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        params: {
          organization_id: process.env.ZOHO_ORG_ID,
          customer_id: customer.contact_id,
          date_start: formatDate(fromDate),
          date_end: formatDate(toDate),
        },
      },
    );

    const invoices = invoiceRes.data.invoices || [];
    console.log("📋 FIRST INVOICE =>", JSON.stringify(invoices[0]));

    const totalSales = invoices.reduce((sum, inv) => sum + inv.total, 0);

    return {
      matched: true,
      match_type: matchType,
      zoho_name: customer.contact_name,
      zoho_gst: customer.gst_no || null,
      zoho_phone: customer.phone || customer.mobile || null,
      from_date: formatDate(fromDate),
      to_date: formatDate(toDate),
      invoice_count: invoices.length,
      total_sales: totalSales,
      invoices: invoices.map((inv) => ({
        invoice_number: inv.invoice_number,
        date: inv.date,
        total: inv.total,
        balance: inv.balance,
        status: inv.status,
      })),
    };
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("❌ GET SHOP SALES ERROR:", JSON.stringify(detail));
    return {
      matched: false,
      shop_name: shopName,
      gst_number: gstNumber,
      phone_number: phoneNumber,
      error: JSON.stringify(detail),
    };
  }
};

// ─── Get Sales Orders ──────────────────────────────────────
const getSalesOrders = async () => {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.get(
      "https://www.zohoapis.in/books/v3/salesorders",
      {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        params: { organization_id: process.env.ZOHO_ORG_ID },
      },
    );

    if (response.data.code !== undefined && response.data.code !== 0) {
      throw new Error(`Zoho API error: ${response.data.message}`);
    }

    return (response.data.salesorders || []).map((order) => ({
      salesorder_id: order.salesorder_id,
      salesorder_number: order.salesorder_number,
      customer_name: order.customer_name,
      status: order.status,
      date: order.date,
      total: order.total,
    }));
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("❌ SALES ORDER FETCH ERROR:", JSON.stringify(detail));
    throw err;
  }
};

// ─── Get Outstanding for ALL shops (GST → Phone → Name) ────
const getShopsOutstanding = async (shops) => {
  const accessToken = await getAccessToken();
  const results = [];

  for (const shop of shops) {
    const shopName = shop.shop_name;
    const gstNumber = shop.gstNumber || shop.gst_number || "";
    const phoneNumber =
      shop.phoneNumber || shop.phone_number || shop.phone || "";

    if (!shopName && !gstNumber && !phoneNumber) continue;

    try {
      let customer = null;
      let matchType = null;

      // ✅ Try GST first
      if (gstNumber) {
        customer = await findContactByGST(gstNumber, accessToken);
        if (customer) matchType = "gst";
      }

      // ✅ Fallback to phone
      if (!customer && phoneNumber) {
        customer = await findContactByPhone(phoneNumber, accessToken);
        if (customer) matchType = "phone";
      }

      // ✅ Fallback to name
      if (!customer && shopName) {
        const customerRes = await axios.get(
          "https://www.zohoapis.in/books/v3/contacts",
          {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
            params: {
              organization_id: process.env.ZOHO_ORG_ID,
              contact_name_contains: shopName,
            },
          },
        );
        const customers = customerRes.data.contacts || [];
        customer = customers[0] || null;
        if (customer) matchType = "name";
      }

      if (!customer) {
        results.push({
          shop_id: shop.shop_id,
          shop_name: shopName,
          matched: false,
          zoho_name: null,
          total_billed: 0,
          outstanding: 0,
          invoice_count: 0,
        });
        continue;
      }

      const invoiceRes = await axios.get(
        "https://www.zohoapis.in/books/v3/invoices",
        {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
          params: {
            organization_id: process.env.ZOHO_ORG_ID,
            customer_id: customer.contact_id,
          },
        },
      );

      const invoices = invoiceRes.data.invoices || [];
      const totalBilled = invoices.reduce(
        (sum, inv) => sum + (inv.total || 0),
        0,
      );
      const outstanding = invoices.reduce(
        (sum, inv) => sum + (inv.balance || 0),
        0,
      );

      results.push({
        shop_id: shop.shop_id,
        shop_name: shopName,
        matched: true,
        match_type: matchType,
        zoho_name: customer.contact_name,
        zoho_gst: customer.gst_no || null,
        zoho_phone: customer.phone || customer.mobile || null,
        total_billed: totalBilled,
        outstanding: outstanding,
        invoice_count: invoices.length,
      });
    } catch (err) {
      results.push({
        shop_id: shop.shop_id,
        shop_name: shopName,
        matched: false,
        error: err.message,
        total_billed: 0,
        outstanding: 0,
        invoice_count: 0,
      });
    }
  }

  return results;
};

// ─── Get Analytics Workspaces (sample function) ─────────────
const getAnalyticsWorkspaces = async () => {
  try {
    const accessToken = await getAnalyticsAccessToken();

    const response = await axios.get(
      "https://analyticsapi.zoho.in/restapi/v2/workspaces",
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "ZANALYTICS-ORGID": process.env.ZOHO_ORG_ID,
        },
      },
    );

    return response.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("❌ ANALYTICS WORKSPACES ERROR:", JSON.stringify(detail));
    throw err;
  }
};

module.exports = {
  getAccessToken,
  getShopSales,
  getSalesOrders,
  getShopsOutstanding,
  findContactByGST,
  findContactByPhone,
  getAnalyticsAccessToken,
  getAnalyticsWorkspaces,
};
