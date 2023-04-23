var mysql = require('mysql');
const config = require(global.__basedir + "/config.json");
const BaseModel = require("../Model/BaseModel");
const BaseUser = require("../Model/BaseUser");
const moment = require("moment")
var _ = require('lodash');
global.__cachedMap = {}

class DatabaseHelper {
    classList = []
    userClassList = []
    constructor() {
        this.connection = mysql.createConnection({
            host: config.db_host,
            user: config.db_user,
            password: config.db_password,
            database: config.db_name
        });
        this.connection.connect()
    }
    setClassList(classList){
        classList.forEach(f => {
            if(f.prototype instanceof BaseUser)
                this.userClassList.push(f)
            else
                this.classList.push(f)
        })
        this.classList = classList
    }
    releaseConnection(){
        this.connection.destroy()
    }
    beginTransaction(){
        this.connection.beginTransaction()
    }
    rollback(){
        this.connection.rollback()
    }
    commit(){
        this.connection.commit()
    }
    filterParameter(classInstance, parameters){
        var parameters = Object.keys(parameters).filter(key => classInstance.getRealField(classInstance.propertyField()).hasOwnProperty(key)).reduce((obj, key) => {
            if(parameters[key] != null && typeof parameters[key] === 'string')
                parameters[key].trim()
            obj[key] = parameters[key];
            return obj;
        }, {})
        Object.keys(BaseModel.propertyField()).forEach(key => {
            delete parameters[key]
        })
        for(const key in parameters){
            if(parameters[key] === true)
                parameters[key] = 1
            else if(parameters[key] === false)
                parameters[key] = 0
        }
        return parameters
    }
    async handleJoinClass(joinClassList){
        for(let i = 0; i < joinClassList.length; i++){
            var joinClass = joinClassList[i]
            joinClass = this.classList.find(f => f.name == joinClass)
            global.__cachedMap[joinClass.name] = {classInstance: joinClass}
            var result = await this.rawGetAll(joinClass)
            result.forEach(row => {
                global.__cachedMap[joinClass.name][row.ID] = row
            })
        }
    }
    handleSearch(rows, classInstance, search){
        var fields = classInstance.propertyField()
        return rows.filter(f => {
            for(const field in fields){
                if(f[field] != null && f[field] != "" && f[field].toString().includes(search))
                    return true
            }
            return false
        })
    }
    handlePaging(rows, pageSize = 25, page = 1){
        rows = rows.slice(pageSize * (page - 1) , pageSize * page)
        return rows
    }
    handleSort(classInstance, rows, sortProp = "ID", sort = "ascending"){
        var field = classInstance.propertyField()[sortProp]
        var fieldType = field != null ? field.type : BaseModel.propertyEnum().NUMBER
        switch(fieldType){
            case BaseModel.propertyEnum().NUMBER:
                rows.sort((a, b) => {
                    try{
                        if(sort == "ascending")
                            return a[sortProp] - b[sortProp]
                        else
                            return b[sortProp] - a[sortProp]
                    }catch(e){
                        return false
                    }
                })
                break;
            case BaseModel.propertyEnum().STRING:
                rows.sort((a, b) => {
                    try{
                        if(sort == "ascending")
                            return a[sortProp].localeCompare(b[sortProp])
                        else
                            return b[sortProp].localeCompare(a[sortProp])
                    }catch(e){
                        return false
                    }
                })
                break;
            case BaseModel.propertyEnum().DATE:
                rows.sort((a, b) => {
                    try{
                        if(sort == "ascending")
                            return moment(a[sortProp]).diff(b[sortProp])
                        else{
                            return moment(b[sortProp]).diff(a[sortProp])
                        }
                    }catch(e){
                        return false
                    }
                })
                break;
        }
        return rows
    }
    handleWhereCondition(rows, whereCondition, whereConditionType){
        if(whereConditionType == "OR"){
            rows = rows.filter(row => {
                for(let i = 0; i < whereCondition.length; i++){
                    var condition = whereCondition[i]
                    if(condition.value == "NULL")
                        condition.value = null
                    switch(condition.type){
                        case "EQUAL":
                            if(row[condition.key] == condition.value)
                                return true;
                            break;
                        case "NOT_EQUAL":
                            if(row[condition.key] != condition.value)
                                return true;
                            break;
                        case "ARRAY_INCLUDE":
                            if(row[condition.key].includes(condition.value))
                                return true;
                            break;
                        case "INCLUDE":
                            if(row[condition.key] != null && row[condition.key].includes(condition.value))
                                return true;
                            break;
                        case "INCLUDE_ARRAY":
                            if(condition.value != null && condition.value.includes(row[condition.key]))
                                return true;
                            break;
                    }
                }
                return false;
            })
            return rows;
        }else if(whereConditionType == "AND"){
            whereCondition.forEach(condition => {
                if(condition.value == "NULL")
                    condition.value = null
                switch(condition.type){
                    case "EQUAL":
                        rows = rows.filter(row =>{
                            return row[condition.key] == condition.value
                        })
                        break;
                    case "NOT_EQUAL":
                        rows = rows.filter(row =>{
                            return row[condition.key] != condition.value
                        })
                        break;
                    case "ARRAY_INCLUDE":
                        rows = rows.filter(row =>{
                            return row[condition.key].includes(condition.value)
                        })
                        break;
                    case "INCLUDE":
                        if(row[condition.key] != null && row[condition.key].includes(condition.value))
                            return true;
                        break;
                    case "INCLUDE_ARRAY":
                            if(condition.value != null && condition.value.includes(row[condition.key]))
                                return true;
                            break;
                }
            })
            return rows
        }
    }
    handleAdvancedSearch(rows, advancedSearch){
        return rows.filter(row => {
            for(const field in advancedSearch){
                try{
                    var fieldObject = advancedSearch[field]
                    switch(fieldObject.type){
                        case "MULTI-SELECTION":
                            for(let i = 0; i < fieldObject.value.length; i++){
                                var value = fieldObject.value[i]
                                var isArray = Array.isArray(row[field])
                                var isMatch = row[field] == value || (isArray && row[field].includes(value))
                                if(row[field] != null && isMatch)
                                    return true
                            }
                            break;
                        case "TIME-RANGE":
                            if(fieldObject.value.length == 2){
                                var startDate = new Date(fieldObject.value[0])
                                var endDate = new Date(fieldObject.value[1])
                                var targetDate = new Date(row[field]) 
                                if(targetDate >= startDate && targetDate <= endDate)
                                    return true
                            }
                            break;
                    }
                }catch(e){
                    console.log(e);
                }
            }
            return false
        })
    }
    async rawQuery(query) {
        return new Promise((resolve, reject) => {
            this.connection.query(query, function(error, result, fields) {
                if (error) reject(error);
                resolve(result)
            });
        })
    }
    async rawGetAll(classInstance){
        return new Promise((resolve, reject) => {
            this.connection.query("SELECT * FROM " + classInstance.name + " WHERE isDeleted = ?", [0], async (error, result, fields) =>{
                if (error) reject(error);
                try{
                    resolve(result)
                }catch(e){
                    reject(e)
                }
            })
        })
    }
    async getAll(classInstance, options = {}){
        return new Promise((resolve, reject) => {
            this.connection.query("SELECT * FROM " + classInstance.name + " WHERE isDeleted = ?", [0], async (error, result, fields) =>{
                if (error) reject(error);
                try{
                    var rows = result
                    if(options.hasOwnProperty("whereCondition"))
                        rows = this.handleWhereCondition(rows, options["whereCondition"], options["whereConditionType"] ?? "OR")
                    if(options.hasOwnProperty("advancedSearch") && !_.isEmpty(options["advancedSearch"]))
                        rows = this.handleAdvancedSearch(rows, options["advancedSearch"])
                    if(options.hasOwnProperty("search") && options["search"] != "" && options["search"] != null)
                        rows = this.handleSearch(rows, classInstance, options["search"])
                    if(!(options.hasOwnProperty("ignoreChecking") && options.ignoreChecking == true))
                        rows = this.checkingPermission(classInstance, options, rows, {}, "GET")
                    var pageSize = rows.length
                    if(options.hasOwnProperty("sortProp") || options.hasOwnProperty("sort"))
                        rows = this.handleSort(classInstance, rows, options["sortProp"], options["sort"])
                    if(options.hasOwnProperty("pageSize") || options.hasOwnProperty("page")){
                        rows = this.handlePaging(rows, options["pageSize"], options["page"])
                        if(options.hasOwnProperty("joinClass")){
                            await this.handleJoinClass(options["joinClass"])
                            rows = rows.map(f => new classInstance(Object.assign(f,{joinClass: options["joinClass"]})))
                        }else
                            rows = rows.map(f => new classInstance(f))
                        resolve({data: rows, totalRow: pageSize})
                    }else{
                        if(options.hasOwnProperty("joinClass")){
                            await this.handleJoinClass(options["joinClass"])
                            rows = rows.map(f => new classInstance(Object.assign(f,{joinClass: options["joinClass"]})))
                        }else{
                            rows = rows.map(f => new classInstance(f))
                        }
                    }
                }catch(e){
                    reject(e)
                }
                resolve(rows)
            });
        })
    }
    async get(classInstance, ID, options = {}){
        return new Promise((resolve, reject) => {
            this.connection.query("SELECT * FROM " + classInstance.name + " WHERE isDeleted = ? AND ID = ?", [0, ID], async (error, result, fields) =>{
                if (error) reject(error);
                try{
                    if(options.hasOwnProperty("joinClass")){
                        await this.handleJoinClass(options["joinClass"])
                        var rows = result.map(f => new classInstance(Object.assign(f,{joinClass: options["joinClass"]})))
                    }else{
                        var rows = result.map(f => new classInstance(f))   
                    }
                    var rows = result.map(f => new classInstance(f, {joinClass: options["joinClass"]}))
                    if(!(options.hasOwnProperty("ignoreChecking") && options.ignoreChecking == true))
                        rows = this.checkingPermission(classInstance, options, rows, {}, "GET")
                    if(rows.length > 0)
                        resolve(rows[0])
                    else
                        resolve(null)
                }catch(e){
                    reject(e)
                }
            });
        })
    }
    async update(classInstance, parameters, options = {}){
        return new Promise((resolve, reject) => {
            try{
                var ID = parameters["ID"];
                parameters = this.filterParameter(classInstance, parameters)
                if(!(options.hasOwnProperty("ignoreChecking") && options.ignoreChecking == true))
                    parameters = this.checkingPermission(classInstance, options, [], parameters, "UPDATE")
                var query = "UPDATE " + classInstance.name + " SET "
                var valueList = []
                Object.keys(parameters).forEach(key => {
                    query += key + " = ?,"
                    if(isJson(parameters[key]) && parameters[key] == "{}")
                        valueList.push("{}")
                    else if(isJson(parameters[key]))
                        valueList.push(JSON.stringify(parameters[key]))
                    else if((classInstance.propertyField()[key].type == BaseModel.propertyEnum().NUMBER || classInstance.propertyField()[key].type == BaseModel.propertyEnum().BOOLEAN) && parameters[key] != null)
                        valueList.push(Number(parameters[key]))
                    else
                        valueList.push(parameters[key])
                })
                query += "modifiedDate = '" + moment().format("YYYY-MM-DD HH:mm:ss") + "'"
                query += " WHERE ID = " + ID
            }catch(e){
                reject(e)
            }
            this.connection.query(query,valueList, (error, result, fields)=> {
                if (error) reject(error);
                resolve(ID)
            })
        })
    }
    async insert(classInstance, parameters, options = {}){
        return new Promise((resolve, reject) => {
            try{
                parameters = this.filterParameter(classInstance, parameters)
                if(!(options.hasOwnProperty("ignoreChecking") && options.ignoreChecking == true))
                    parameters = this.checkingPermission(classInstance, options, [], parameters, "INSERT")
                parameters = classInstance.setParameterDefaultValue(parameters)
                var query = "INSERT INTO " + classInstance.name + " SET "
                var valueList = []
                Object.keys(parameters).forEach(key => {
                    query += key + " = ?,"
                    if(isJson(parameters[key]) && parameters[key] == "{}")
                        valueList.push("{}")
                    else if(isJson(parameters[key]))
                        valueList.push(JSON.stringify(parameters[key]))
                    else if((classInstance.propertyField()[key].type == BaseModel.propertyEnum().NUMBER || classInstance.propertyField()[key].type == BaseModel.propertyEnum().BOOLEAN) && parameters[key] != null)
                        valueList.push(Number(parameters[key]))
                    else
                        valueList.push(parameters[key])
                })
                query += "createdDate = '" + moment().format("YYYY-MM-DD HH:mm:ss") + "'"
            }catch(e){
                reject(e)
            }
            this.connection.query(query, valueList,(error, result, fields)=> {
                if (error) reject(error);
                if(result == null)
                    resolve(null)
                else
                    resolve(result.insertId)
            })
        })
    }
    async delete(classInstance, ID, options = {}){
        return new Promise((resolve, reject) => {
            try{
                var query = "UPDATE " + classInstance.name + " SET isDeleted = 1, "
                query += "modifiedDate = '" + moment().format("YYYY-MM-DD HH:mm:ss") + "'"
                query += " WHERE ID = " + ID
                if(!(options.hasOwnProperty("ignoreChecking") && options.ignoreChecking == true))
                    this.checkingPermission(classInstance, options, [], {}, "DELETE")
                this.connection.query(query, (error, result, fields)=> {
                    if (error) reject(error);
                    resolve(ID)
                })
                resolve(ID)
            }catch(e){
                reject(e)
            }
        })
    }
    static checkRequestUserType(user, allowedTypeList){
        for(let i = 0; i < user.type.length; i++){
            var type = user.type[0]
            if(allowedTypeList.includes(type))
                return true
        }
        return false
    }
    checkingPermission(classInstance, options, rows = [], parameters = {} ,actionType){
        switch(actionType){
            case "GET":
                if(!options.hasOwnProperty("checkUserPermission") && typeof classInstance.permissionGet == "function")
                    return classInstance.permissionGet(rows,options.checkUserPermission, null)
                else{
                    this.userClassList.forEach(f => {
                        if(options.hasOwnProperty("check" + f.name + "Permission") && typeof classInstance[f.name.toLowerCase() + "PermissionGet"] == "function"){
                            // return classInstance[f.name.toLowerCase() + "PermissionGet"](rows,options.checkUserPermission)
                            return classInstance.permissionGet(rows,options.checkUserPermission, null, f)
                        }
                    })
                }
                return rows;
                break;
            case "INSERT":
                if(!options.hasOwnProperty("checkUserPermission") && typeof classInstance.permissionInsert == "function")
                    return classInstance.permissionInsert(parameters,options.checkUserPermission, null)
                else{
                    this.userClassList.forEach(f => {
                        if(options.hasOwnProperty("check" + f.name + "Permission") && typeof classInstance[f.name.toLowerCase() + "PermissionInsert"] == "function"){
                            // return classInstance[f.name.toLowerCase() + "PermissionInsert"](parameters,options["check" + f.name + "Permission"])
                            return classInstance.permissionInsert(parameters,options.checkUserPermission, f)
                        }
                    })
                }
                return parameters;
                break
            case "UPDATE":
                if(!options.hasOwnProperty("checkUserPermission") && typeof classInstance.permissionUpdate == "function")
                    return classInstance.permissionUpdate(parameters,options.checkUserPermission, null)
                else{
                    this.userClassList.forEach(f => {
                        if(options.hasOwnProperty("check" + f.name + "Permission") && typeof classInstance[f.name.toLowerCase() + "PermissionUpdate"] == "function"){
                            // return classInstance[f.name.toLowerCase() + "PermissionUpdate"](parameters,options["check" + f.name + "Permission"])
                            return classInstance.permissionUpdate(parameters,options.checkUserPermission, f)
                        }
                    })
                }
                return parameters;
                break
            case "DELETE":
                if(!options.hasOwnProperty("checkUserPermission") && typeof classInstance.permissionDelete == "function")
                    return classInstance.permissionDelete(parameters,options.checkUserPermission)
                else{
                    this.userClassList.forEach(f => {
                        if(options.hasOwnProperty("check" + f.name + "Permission") && typeof classInstance[f.name.toLowerCase() + "PermissionDelete"] == "function"){
                            // return classInstance[f.name.toLowerCase() + "PermissionDelete"](parameters,options["check" + f.name + "Permission"])
                            return classInstance.permissionDelete(parameters,options.checkUserPermission, f)
                        }
                    })
                }
                break
        }
    }
}

function isJson(item) {
    if(Array.isArray(item))
        return true
    item = typeof item !== "string"
        ? JSON.stringify(item)
        : item;
    try {
        item = JSON.parse(item);
    } catch (e) {
        return false;
    }
    if (typeof item === "object" && item !== null) {
        return true;
    }
    return false;
}
module.exports = DatabaseHelper