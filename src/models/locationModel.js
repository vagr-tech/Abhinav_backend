const ddb = require("../config/dynamo");
const {
  PutCommand,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE = "abhinav_warehouse_locations";

module.exports = {
  // ✅ Company-ன் all locations fetch
  async getByCompany(companyId) {
    const res = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: {
          PK: `COMPANY#${companyId}`,
          SK: "LOCATIONS",
        },
      }),
    );
    return res.Item?.locations || [];
  },

  // ✅ புதுசா company-க்கு locations list create
  async create({ companyId, companyName, locations }) {
    return ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `COMPANY#${companyId}`,
          SK: "LOCATIONS",
          companyId,
          companyName,
          locations,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  },

  // ✅ FIXED - Item இல்லன்னா create, இருந்தா append
  async addLocation({ companyId, companyName, location }) {
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: {
          PK: `COMPANY#${companyId}`,
          SK: "LOCATIONS",
        },
      }),
    );

    // ✅ First time - companyName save ஆகும்
    if (!existing.Item) {
      return ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            PK: `COMPANY#${companyId}`,
            SK: "LOCATIONS",
            companyId,
            companyName, // ✅
            locations: [location],
            createdAt: new Date().toISOString(),
          },
        }),
      );
    }

    // ✅ Already exists - companyName update + append
    return ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: {
          PK: `COMPANY#${companyId}`,
          SK: "LOCATIONS",
        },
        UpdateExpression:
          "SET locations = list_append(locations, :newLoc), companyName = :cn",
        ExpressionAttributeValues: {
          ":newLoc": [location],
          ":cn": companyName, // ✅
        },
      }),
    );
  },

  // ✅ Location remove
  async removeLocation({ companyId, locationIndex }) {
    return ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: {
          PK: `COMPANY#${companyId}`,
          SK: "LOCATIONS",
        },
        UpdateExpression: `REMOVE locations[${locationIndex}]`,
      }),
    );
  },
};
