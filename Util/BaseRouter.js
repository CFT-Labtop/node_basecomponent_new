const config = require(global.__basedir + "/config.json");
const DatabaseHelper = require("./DatabaseHelper")
const BaseUser = require("../Model/BaseUser");
const express = require('express')
const fs = require("fs")
const cors = require('cors');
const fileUpload = require('express-fileupload');
const mime = require('mime-types')
const bodyParser = require('body-parser')
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const crypto = require('crypto');
var moment = require('moment-timezone');
moment.tz.setDefault('Asia/Hong_Kong')

const {S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
var databaseHelper = new DatabaseHelper()
class BaseRouter {
    classList = []
    userClassList = []
    constructor(classList) {
        this.app = express()
        this.setClassList(classList)
        databaseHelper.setClassList(this.classList)
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
    setCORS(corsOptions = null){
        if(corsOptions != null){
            if(!corsOptions.hasOwnProperty["methods"])
                corsOptions["methods"] = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'
            this.app.use(cors(corsOptions))
        }else
            this.app.use(cors({ credentials: true, origin: true }))
    }
    generateCheckUserOptions(req){
        var options = {}
        this.userClassList.forEach(f => {
            if(req["__" + f.name.toLowerCase()] != null)
                options["check" + f.name + "Permission"] = req["__" + f.name.toLowerCase()]
        })
        options["sessionID"] = req.sessionID
        return options
    }
    async init(callback){
        this.app.use(express.urlencoded({extended: true, limit: "50mb", parameterLimit: 100000,}));
        this.app.use(express.json({limit: '50mb'}));
        this.app.use(fileUpload({createParentPath: true}));
        this.app.use(express.static('uploads'))
        this.app.use(bodyParser.json({limit: '50mb'}));
        this.app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));
        this.app.use(session({
            secret: config.apikey,
            resave: false,
            store: new FileStore(),
            saveUninitialized: true,
            cookie: { secure: false, maxAge: 24* 60 * 60 * 1000  }
        }))
        this.setLogMiddleware()
        this.setSecretMiddleware()
        this.setApikeyMiddleware()
        this.setGetUserMiddleware()
        if(config.isAWSBucket){
            this.setAWSBucketMiddleware()
        }
        this.setAuthAPI()
        this.classList.forEach(f => {
            this.app.post(config.base_path +"get/"  +f.name, async (req, res, next) => {
                try{
                    var options = Object.assign(req.body, this.generateCheckUserOptions(req))
                    if(req.body.ID == null){
                        var result = successResponseMessage()
                        result.data[f.name] = await databaseHelper.getAll(f, options)
                    }else{
                        var result = successResponseMessage()
                        result.data[f.name] = await databaseHelper.get(f, req.body.ID, options)
                    }
                    res.json(result)
                }catch(error){
                    next(error)
                }
            })
            this.app.put(config.base_path + f.name, async (req, res, next) => {
                try{
                    var options = Object.assign(req.body, this.generateCheckUserOptions(req))
                    databaseHelper.beginTransaction()
                    var instance = await databaseHelper.get(f, req.body.ID, options)
                    if(typeof instance.update == "function")
                        await instance.update(req.body, options)
                    else
                        await databaseHelper.update(f, req.body, options)
                    databaseHelper.commit()
                    res.json(successResponseMessage())
                }catch(error){
                    databaseHelper.rollback()
                    next(error)
                }
            })
            this.app.post(config.base_path + f.name, async (req, res, next) => {
                try{
                    var options = Object.assign(req.body, this.generateCheckUserOptions(req))
                    databaseHelper.beginTransaction()
                    var response = successResponseMessage() 
                    response["data"][f.name] = {} 
                    if(f.hasOwnProperty("insert") && typeof f.insert === "function"){
                        response["data"][f.name]["ID"] = await f.insert(req.body, options)
                    }
                    else
                        response["data"][f.name]["ID"] = await databaseHelper.insert(f, req.body, options)
                    databaseHelper.commit()
                    res.json(response)
                }catch(error){
                    databaseHelper.rollback()
                    next(error)
                }
            })
            this.app.delete(config.base_path + f.name, async (req, res, next) => {
                try{
                    var options = Object.assign(req.body, this.generateCheckUserOptions(req))
                    await databaseHelper.delete(f, req.body.ID, options)
                    res.json(successResponseMessage())
                }catch(error){
                    next(error)
                }
            })
            this.app.post(config.base_path + "uploadFile", async (req, res, next) => {
                try{
                    var file = req.files.file
                    var fileName = randomString(24) + "_" +moment().format("YYYY_MM_DD_HH_mm_ss") + "." + mime.extension(file.mimetype)
                    await file.mv(global.__basedir + "/uploads/" +fileName)
                    var response = successResponseMessage()
                    response.data.path = fileName
                    res.json(response)
                }catch(error){
                    next(error)
                }
            })
        })
        global.__databaseHelper = databaseHelper
        await callback(this.app,databaseHelper)
        this.setErrorLogMiddleware()
        this.app.listen(config.port, () => {
            console.log(`Example app listening on port ${config.port}`)
        })
    }
    setAuthAPI(){
        for(let i = 0; i < this.userClassList.length; i++){
            this.app.post(config.base_path + "check/" + this.userClassList[i].name.toLowerCase(), async (req, res, next) => {
                try{
                    var userClass = this.userClassList[i]
                    if(req["__" + userClass.name.toLowerCase()] == null){
                        var error = new Error("Token Invalid")
                        error.code = "-13"
                        throw error
                    }
                    res.json(successResponseMessage())
                }catch(e){
                    next(error)
                }
            })
            this.app.post(config.base_path + this.userClassList[i].name.toLowerCase() + "/login", async (req, res, next) => {
                var userClass = this.userClassList[i]
                try{
                    if(userClass.name == "User")
                        var tokenName = "token"
                    else
                        var tokenName = userClass.name.toLowerCase() + "_token"
                    var tokenClass = this.classList.find(f => f.name.toLowerCase() == tokenName)
                    databaseHelper.beginTransaction()
                    var userList = await databaseHelper.getAll(userClass, {whereConditionType: "AND", whereCondition: [
                        {type: "EQUAL", key: "loginName", "value": req.body.loginName},
                        {type: "EQUAL", key: "password", "value": req.body.password}
                    ]})     
                    if(userList.length == 0)
                        throw new Error("Please check username or password")
                    var user = userList[0]
                    var tokenList = await databaseHelper.getAll(tokenClass, {whereCondition: [
                        {type: "EQUAL", key: "userID", "value": user.ID},
                    ]})
                    tokenList.forEach(async token => {
                        await databaseHelper.delete(tokenClass, token.ID)
                    })
                    var token = randomString(24)
                    var ID = await databaseHelper.insert(tokenClass, {userID: user.ID, token: token})
                    var responseMessage = successResponseMessage()
                    responseMessage["ID"] = ID
                    databaseHelper.commit()
                    var result = responseMessage
                    result.data[tokenName] = token
                    result.data[userClass.name] = user
                    res.json(result)
                }catch(e){
                    console.log(e);
                    databaseHelper.rollback()
                    next(e)
                }
            })
            this.app.post(config.base_path + this.userClassList[i].name.toLowerCase() + "/logout", async (req, res, next) => {
                try{
                    var userClass = this.userClassList[i]
                    if(userClass.name == "User")
                        var tokenName = "token"
                    else
                        var tokenName = userClass.name.toLowerCase() + "_token"
                    var tokenClass = this.classList.find(f => f.name.toLowerCase() == tokenName)
                    if(req["__" + userClass.name.toLowerCase()] == null){
                        var error = new Error("Token Invalid")
                        error.code = "-13"
                        next(error)
                    }
                    databaseHelper.beginTransaction()
                    var tokenList = await databaseHelper.getAll(tokenClass, {whereCondition: [
                        {type: "EQUAL", key: "userID", "value": req["__" + userClass.name.toLowerCase()].ID},
                    ]})
                    tokenList.forEach(async token => {
                        await databaseHelper.delete(tokenClass, token.ID)
                    })
                    databaseHelper.commit()
                    res.json(successResponseMessage())
                }catch(e){
                    databaseHelper.rollback()
                    next(e)
                }
            })
        }
    }
    setGetUserMiddleware(){
        this.app.use(async (req, res, next) => {
            try{
                for(let i = 0; i < this.userClassList.length; i++){
                    var f = this.userClassList[i]
                    if(f.name == "User")
                        var tokenName = "token"
                    else
                        var tokenName = f.name.toLowerCase() + "_token"
                    if(req.headers.hasOwnProperty(tokenName)){
                        var tokenList = await databaseHelper.getAll(this.classList.find(f => f.name.toLowerCase() == tokenName), {whereCondition: [
                            {type: "EQUAL", key: "token", value: req.headers[tokenName]}
                        ]})
                        if(tokenList.length > 0){
                            var token = tokenList[0]
                            var user = await databaseHelper.get(f, token.userID)
                            req["__" + f.name.toLowerCase()] = user
                        }
                    }
                }
            }catch(e){
                next(e)
            }
            next()
        })
    }
    setApikeyMiddleware(){
        this.app.use((req, res, next) => {
            if(req.headers["apikey"] == config.apikey || req.headers["Apikey"] == config.apikey || req.path.includes("/uploads/"))
                next()
            else{
                var error = new Error("API Key Failed")
                error.code = "-11"
                next(error)
            }
        })
    }
    setErrorLogMiddleware(){
        this.app.use((err, req, res, next) => {
            var requestInformation = {
                baseUrl: req.baseUrl,
                originalUrl: req.originalUrl,
                body: req.body,
                query: req.query,
                ip: req.ip,
                method: req.method,
                params: req.params,
                protocol: req.protocol,
                headers: req.headers,
                date: moment().format("YYYY-MM-DD HH:mm:ss")
            }
            var errorLog = {
                message: err.message,
                name: err.name,
                stack: err.stack
            }
            fs.appendFile(global.__basedir + "/log/errorLog_" + moment().format("YYYY-MM-DD"), JSON.stringify({req: requestInformation, err: errorLog}) + "\n", err => {
                if (err) {console.error(err);}
            })
            res.json({code: err.code ?? "UNKNOWN", message: err.message, stack: err.stack})
        })
    }
    setLogMiddleware(){
        this.app.use((req, res, next) => {
            fs.appendFile(global.__basedir + "/log/log_" + moment().format("YYYY-MM-DD"), JSON.stringify({
                baseUrl: req.baseUrl,
                originalUrl: req.originalUrl,
                body: req.body,
                query: req.query,
                ip: req.ip,
                method: req.method,
                params: req.params,
                protocol: req.protocol,
                headers: req.headers,
                date: moment().format("YYYY-MM-DD HH:mm:ss")
            }) + "\n", err => {
                if (err) {console.error(err);}
            });
            next()
        });
    }
    setSecretMiddleware(){
        this.app.use((req, res, next) => {
            try{
                var today = moment().format("yyyy-MM-DD")
                var yesterday = moment().subtract(1, 'day').format("yyyy-MM-DD")
                var sha = crypto.createHash("sha256")
                var todayHash = sha.update(today + config.apikey).digest("hex")
                var sha = crypto.createHash("sha256")
                var yesterdayHash = sha.update(yesterday + config.apikey).digest("hex")
                if(req.headers["secret"] == yesterdayHash || req.headers["secret"] == todayHash || req.path.includes("/uploads/"))
                    next()
                else{
                    var error = new Error("Secret Failed")
                    error.code = "-13"
                    next(error)
                }
            }catch(e){
                console.log(e);
                throw new Error(e)
            }
        });
    }
    setAWSBucketMiddleware(){
        const s3Client = new S3Client(
            { region: config.bucket_region, credentials: {accessKeyId: config.bucket_keyID, secretAccessKey: config.bucket_secret} }
        )

        this.app.post(config.base_path + "uploadFile_AWS", async (req, res, next) => {
            try{
                var file = req.files.file
                var fileName = randomString(24) + "_" + moment().format("YYYY_MM_DD_HH_mm_ss") + "." + mime.extension(file.mimetype)
                const uploadToBucket = async () => {
                    const bucketParams = { Bucket: config.bucket_name, Key: `uploads/${fileName}`, Body: file.data, };
                    var path = `uploads/${fileName}`
                    try {
                        const data = await s3Client.send(new PutObjectCommand(bucketParams));
                        console.log("Success");
                    } catch (error) {
                        console.log("Error", error);
                    }
                    return path
                };
                var response = successResponseMessage()
                response.data.path = await uploadToBucket()
                res.json(response)
            }catch(error){
                console.log(error)
            }
        })
    }
}
function successResponseMessage(){
    return {
        code: "200",
        message: "Success",
        data: {}
    }
}
function randomString(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}

module.exports = BaseRouter