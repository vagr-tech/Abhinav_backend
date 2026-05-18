const express = require("express");
const router = express.Router();
const { getSalesOrders } = require("../services/zohoService");

// ✅ GET SALES ORDERS WITH FILTER + SEARCH + PAGINATION
// Usage:
// /api/zoho/salesorders
// /api/zoho/salesorders?status=draft
// /api/zoho/salesorders?search=KS TRADERS
// /api/zoho/salesorders?status=invoiced&search=BALAJI
// /api/zoho/salesorders?page=2&limit=20
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = require("../config/dynamo");
const { getShopsOutstanding } = require("../services/zohoService");

// ✅ GET OUTSTANDING FOR ALL DB SHOPS
router.get("/shops-outstanding", async (req, res) => {
  try {
    // Step 1: DB-ல் எல்லா shops எடு
    let items = [];
    let lastKey = undefined;

    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: "abhinav_shops",
          FilterExpression:
            "sk = :profile AND (attribute_not_exists(isDeleted) OR isDeleted = :false)",
          ExpressionAttributeValues: {
            ":profile": "PROFILE",
            ":false": false,
          },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    if (items.length === 0) {
      return res.json({ success: true, shops: [], summary: {} });
    }

    // Step 2: Zoho match + outstanding எடு
    const shops = await getShopsOutstanding(items);

    // Step 3: Summary calculate
    const matched = shops.filter((s) => s.matched);
    const totalBilled = matched.reduce((sum, s) => sum + s.total_billed, 0);
    const totalOutstanding = matched.reduce((sum, s) => sum + s.outstanding, 0);

    // Step 4: Sort by outstanding (high first)
    shops.sort((a, b) => b.outstanding - a.outstanding);

    res.json({
      success: true,
      summary: {
        total_shops: shops.length,
        matched_shops: matched.length,
        unmatched_shops: shops.length - matched.length,
        total_billed: totalBilled,
        total_outstanding: totalOutstanding,
      },
      shops,
    });

  } catch (err) {
    console.error("❌ SHOPS OUTSTANDING ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/salesorders", async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    let orders = await getSalesOrders();

    // ── 1. Status Filter ──────────────────────────────
    if (status) {
      const statusFilter = status.toLowerCase();
      orders = orders.filter(
        (o) => o.status?.toLowerCase() === statusFilter
      );
    }

    // ── 2. Shop Name Search ───────────────────────────
    if (search) {
      const searchTerm = search.toLowerCase();
      orders = orders.filter((o) =>
        o.customer_name?.toLowerCase().includes(searchTerm)
      );
    }

    // ── 3. Status Summary (எல்லா counts) ─────────────
    const allOrders = await getSalesOrders(); // full list for summary
    const summary = allOrders.reduce((acc, o) => {
      const s = o.status || "unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    // ── 4. Pagination ─────────────────────────────────
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const totalFiltered = orders.length;
    const totalPages = Math.ceil(totalFiltered / limitNum);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedOrders = orders.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      // Summary
      summary,                        // { draft: 3, invoiced: 42, ... }
      // Filter info
      filters: {
        status: status || "all",
        search: search || "",
      },
      // Pagination info
      pagination: {
        total: totalFiltered,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
      // Orders
      orders: paginatedOrders,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ✅ GET SINGLE ORDER BY ID
router.get("/salesorders/:id", async (req, res) => {
  try {
    const orders = await getSalesOrders();
    const order = orders.find((o) => o.salesorder_id === req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ✅ GET STATUS SUMMARY ONLY
router.get("/salesorders-summary", async (req, res) => {
  try {
    const orders = await getSalesOrders();

    const summary = orders.reduce((acc, o) => {
      const s = o.status || "unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const totalAmount = orders.reduce((sum, o) => sum + (o.total || 0), 0);

    res.json({
      success: true,
      total_orders: orders.length,
      total_amount: totalAmount,
      summary,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;