const {
  PutCommand,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const ddb = require("../config/dynamo.js");

const TABLE = "abhinav_attendance";

const nowIST = () =>
  new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

const Attendance = {
  async get(uid, date) {
    const res = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: {
          PK: `USER#${uid}`,
          SK: `DATE#${date}`,
        },
      }),
    );
    return res.Item || null;
  },

  async checkIn({
    uid,
    userName,
    companyId,
    companyName,
    date,
    lat,
    lng,
    distance,
    locationId,
    locationName,
  }) {
    return ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${uid}`,
          SK: `DATE#${date}`,
          GSI1PK: `DATE#${date}`,
          GSI1SK: `LOC#${locationId}#USER#${uid}`,
          userName,
          companyId, // ✅
          companyName, // ✅
          checkInAt: nowIST(),
          checkInLat: lat,
          checkInLng: lng,
          checkInDistance: distance,
          checkInLocationId: locationId,
          checkInLocationName: locationName,
          status: "CHECKED_IN",
          createdAt: nowIST(),
        },
        ConditionExpression: "attribute_not_exists(SK)",
      }),
    );
  },

  async checkOut({ uid, date, lat, lng, locationId, locationName, distance }) {
    return ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: {
          PK: `USER#${uid}`,
          SK: `DATE#${date}`,
        },
        UpdateExpression:
          "SET checkOutAt = :t, checkOutLat = :lat, checkOutLng = :lng, checkOutLocationId = :locId, checkOutLocationName = :locName, checkOutDistance = :dist, #s = :s",
        ConditionExpression:
          "attribute_exists(PK) AND attribute_not_exists(checkOutAt)",
        ExpressionAttributeNames: {
          "#s": "status",
        },
        ExpressionAttributeValues: {
          ":t": nowIST(),
          ":lat": lat,
          ":lng": lng,
          ":locId": locationId,
          ":locName": locationName,
          ":dist": distance,
          ":s": "CHECKED_OUT",
        },
      }),
    );
  },
};

module.exports = { Attendance };
