
module.exports = async function generateShopId() {
  const counter = await Counter.findOneAndUpdate(
    { name: "shop_id" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const num = counter.seq.toString().padStart(3, "0");
  return `S${num}`;
};
