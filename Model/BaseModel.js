const moment = require("moment")
// const isHtml = require("is-html")
class BaseModel {
    constructor(parameters = {joinClass: []}) {
        try{
            var propertyField = this.constructor.propertyField()
            this.initField(propertyField)
            for(const key in propertyField){
                var currentField = propertyField[key]
                switch(currentField.type){
                    case "NUMBER":
                        if(parameters.hasOwnProperty(key)){
                            if(parameters[key] == null)
                                this[key] = null
                            else
                                this[key] = Number(parameters[key])
                        }
                        break;
                    case "DATE":
                        if(parameters.hasOwnProperty(key) && parameters[key] != null)
                            this[key] = moment(parameters[key]).format("YYYY-MM-DD HH:mm:ss")
                        else 
                            parameters[key] = null
                        break;
                    case "STRING":
                        if(parameters.hasOwnProperty(key))
                            this[key] = parameters[key]
                        break;
                    case "BOOLEAN":
                        if(parameters.hasOwnProperty(key))
                            this[key] = parameters[key] == 1 ? true: false
                        break;
                    case "OBJECT":
                        if(parameters.hasOwnProperty(key)){
                            this[key] = JSON.parse(parameters[key])
                        }
                        break;
                    case "ARRAY":
                        try {
                            if(parameters.hasOwnProperty(key))
                                this[key] = JSON.parse(parameters[key])
                        } catch (error) {
                            this[key] = []
                        }
                        break;
                    case "TO_MULTI":
                        try{
                            if(global.__cachedMap.hasOwnProperty(currentField["class"].name) && parameters.hasOwnProperty("joinClass") && parameters["joinClass"].includes(currentField["class"].name)){
                                var tableMap = global.__cachedMap[currentField["class"].name]
                                for(const ID in tableMap){
                                    var row = tableMap[ID]
                                    if(row[currentField["field"]] == this.ID)
                                        this[key].push(new tableMap["classInstance"](Object.assign(row, {joinClass: parameters["joinClass"].filter(f => f != currentField["class"].name)})))
                                }
                            }
                        }catch(e){
                            this[key] = []
                        }
                        break;
                    case "TO_SINGLE":
                        try{
                            if(global.__cachedMap.hasOwnProperty(currentField["class"].name) && parameters.hasOwnProperty("joinClass") && parameters["joinClass"].includes(currentField["class"].name)){
                                var tableMap = global.__cachedMap[currentField["class"].name]
                                this[key] = new tableMap["classInstance"](Object.assign(tableMap[this[currentField["field"]]], {joinClass: parameters["joinClass"].filter(f => f != currentField["class"].name)}))
                            }
                        }catch(e){
                            this[key] = null
                        }
                        break;
                }
            }
        }catch(e){
            throw e
        }
    }
    static setParameterDefaultValue(parameters){
        for(const key in this.propertyField()){
            var currentField = this.propertyField()[key]
            if((!parameters.hasOwnProperty(currentField.name) || parameters[currentField.name] == null) && currentField.type == BaseModel.propertyEnum().OBJECT){
                parameters[currentField.name] = "{}"
            }else if((!parameters.hasOwnProperty(currentField.name) || parameters[currentField.name] == null) && currentField.hasOwnProperty("defaultValue")){
                parameters[currentField.name] = currentField.defaultValue
            }
        }
        return parameters
    }
    static propertyField(){
        return {
            ID: {name: "ID", type: BaseModel.propertyEnum().NUMBER},
            createdDate: {name: "createdDate", type: BaseModel.propertyEnum().DATE},
            modifiedDate: {name: "modifiedDate", type: BaseModel.propertyEnum().DATE},
            isDeleted: {name: "isDeleted", type: BaseModel.propertyEnum().BOOLEAN},
            createdUserID: {name: "createdUserID", type: BaseModel.propertyEnum().NUMBER},
            modifiedUserID: {name: "modifiedUserID", type: BaseModel.propertyEnum().NUMBER},
        }
    }
    initField(propertyField){
        for (const field in propertyField) {
            if(propertyField[field].type == "ARRAY" || propertyField[field].type == "TO_MULTI")
                this[field] = []
            else
                this[field] = null
        }
    }
    static getRealField(fieldList){
        var result = {}
        for(const key in fieldList){
            var field = fieldList[key]
            if(field.type == BaseModel.propertyEnum().NUMBER || field.type == BaseModel.propertyEnum().DATE || field.type == BaseModel.propertyEnum().STRING || field.type == BaseModel.propertyEnum().BOOLEAN || field.type == BaseModel.propertyEnum().OBJECT || field.type == BaseModel.propertyEnum().ARRAY)
                result[key] = field
        }
        return result
    }

    static propertyEnum(){
        return {
            "NUMBER": "NUMBER",
            "DATE": "DATE",
            "STRING": "STRING",
            "BOOLEAN": "BOOLEAN",
            "OBJECT": "OBJECT",
            "ARRAY": "ARRAY",
            "TO_MULTI": "TO_MULTI",
            "TO_SINGLE": "TO_SINGLE",
        }
    }
    async updateChildren(parameters, childrenClass, childrenProp, parentProp, options , childCallback = function(){}){
        for(let i = 0; i < parameters[childrenProp].length; i++){
            var child = parameters[childrenProp][i]
            childCallback(child) 
            if(child.hasOwnProperty("ID") && child.ID != null){
                var childInstance = await global.__databaseHelper.get(childrenClass, child.ID)
                if(typeof childInstance.update == "function")
                    await childInstance.update(child, options)
                else
                    await global.__databaseHelper.update(childrenClass, child, options)
            }else{
                if(typeof childrenClass.insert == "function")
                    var ID = await childrenClass.insert(child, options)
                else
                    var ID =await global.__databaseHelper.insert(childrenClass, parameters, options)
                child.ID = ID
            }
        }
        this[childrenProp] = await global.__databaseHelper.getAll(childrenClass, {whereCondition: [
            {type: "EQUAL", key: parentProp, value: this.ID}
        ]})
        for(let i = 0; i < this[childrenProp].length; i++){
            var originalChild = this[childrenProp][i];
            var shouldDelete = true;
            for(let j = 0; j < parameters[childrenProp].length; j++){
                var child = parameters[childrenProp][j]
                if(child.ID != null && originalChild.ID == child.ID){
                    shouldDelete = false
                    break;
                }
            }
            if(shouldDelete){
                if(typeof originalChild.delete == "function")
                    await originalChild.delete()
                else
                    await global.__databaseHelper.delete(childrenClass, originalChild.ID)
            }
        }
    }
}


module.exports = BaseModel