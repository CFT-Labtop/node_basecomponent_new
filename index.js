const BaseModel = require("./Model/BaseModel")
const BaseUser = require("./Model/BaseUser")
const BaseRouter = require("./Util/BaseRouter")
const DatabaseHelper = require("./Util/DatabaseHelper")

// module.exports = {BaseModel, BaseUser, BaseRouter, DatabaseHelper}
module.exports.BaseModel = BaseModel
module.exports.BaseUser = BaseUser
module.exports.BaseRouter = BaseRouter
module.exports.DatabaseHelper = DatabaseHelper