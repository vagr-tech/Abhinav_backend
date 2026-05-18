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

// ─── Find Contact by GST Number ────────────────────────────
// Zoho Books stores GST as "gst_no" on the contact object
const findContactByGST = async (gstNumber, accessToken) => {
  if (!gstNumber || gstNumber.trim() === "") return null;

  try {
    // Fetch all contacts and filter by gst_no
    // Zoho doesn't support direct gst_no filter param, so we search by name loosely
    // and then confirm gst_no match — OR use contact_name_contains as fallback
    const res = await axios.get("https://www.zohoapis.in/books/v3/contacts", {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: {
        organization_id: process.env.ZOHO_ORG_ID,
        // Zoho Books supports gst_no as a search param in some versions
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

// ─── Get Shop Sales (by GST number, fallback to name) ──────
const getShopSales = async (shopName, accessToken, visitDate, gstNumber) => {
  const fromDate = visitDate ? new Date(visitDate) : new Date();
  const toDate = new Date(fromDate);
  toDate.setDate(fromDate.getDate() + 7);

  const formatDate = (d) => d.toISOString().split("T")[0];

  try {
    let customer = null;

    // ✅ Step 1: Try GST match first
    if (gstNumber && gstNumber.trim() !== "") {
      customer = await findContactByGST(gstNumber, accessToken);
      if (customer) {
        console.log(
          `✅ GST match found: ${customer.contact_name} for GST: ${gstNumber}`,
        );
      } else {
        console.warn(`⚠️ No GST match for ${gstNumber}, falling back to name`);
      }
    }

    // ✅ Step 2: Fallback to name if GST not found
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
    }

    if (!customer) {
      return { matched: false, shop_name: shopName, gst_number: gstNumber };
    }

    // ✅ Step 3: Fetch invoices for matched customer
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
      match_type: gstNumber && customer.gst_no ? "gst" : "name",
      zoho_name: customer.contact_name,
      zoho_gst: customer.gst_no || null,
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

// ─── Get Outstanding for ALL shops (by GST, fallback name) ─
const getShopsOutstanding = async (shops) => {
  const accessToken = await getAccessToken();
  const results = [];

  for (const shop of shops) {
    const shopName = shop.shop_name;
    const gstNumber = shop.gstNumber || shop.gst_number || "";

    if (!shopName && !gstNumber) continue;

    try {
      let customer = null;

      // ✅ Try GST first
      if (gstNumber) {
        customer = await findContactByGST(gstNumber, accessToken);
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
        match_type: gstNumber && customer.gst_no ? "gst" : "name",
        zoho_name: customer.contact_name,
        zoho_gst: customer.gst_no || null,
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

module.exports = {
  getAccessToken,
  getShopSales,
  getSalesOrders,
  getShopsOutstanding,
  findContactByGST,
};
