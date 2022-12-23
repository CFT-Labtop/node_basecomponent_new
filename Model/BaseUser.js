const BaseModel = require("./BaseModel")
class BaseUser extends BaseModel {
    constructor(parameters) {
        super(parameters)
    }
    static propertyField(){
        return Object.assign(super.propertyField(), {
            password: {name: "password", type: BaseModel.propertyEnum().STRING},
            loginName: {name: "loginName", type: BaseModel.propertyEnum().STRING},
            userName: {name: "userName", type: BaseModel.propertyEnum().STRING},
            type: {name: "userName", type: BaseModel.propertyEnum().ARRAY},
        })
    }
    static 
}
module.exports = BaseUser