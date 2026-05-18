const Location = require("../models/locationModel");

module.exports = {
  createLocations: async (req, res) => {
    const { locations } = req.body;
    const { companyId, companyName } = req.user;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.json({ ok: false, error: "locations_required" });
    }

    try {
      await Location.create({ companyId, companyName, locations });
      res.json({ ok: true, message: "Locations created" });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  },
};

// ✅ companyName add பண்ணினேன்
module.exports.addLocation = async (req, res) => {
  const { name, lat, lng, radius } = req.body;
  const { companyId, companyName } = req.user; // ✅ companyName எடுக்கிறோம்

  if (!name || !lat || !lng || !radius) {
    return res.json({ ok: false, error: "all_fields_required" });
  }

  const locationId = "LOC" + Date.now();

  try {
    await Location.addLocation({
      companyId,
      companyName, // ✅ pass பண்றோம்
      location: { locationId, name, lat, lng, radius },
    });
    res.json({ ok: true, message: "Location added", locationId });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
};

module.exports.getLocations = async (req, res) => {
  const { companyId } = req.user;
  try {
    const locations = await Location.getByCompany(companyId);
    res.json({ ok: true, locations });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
};
