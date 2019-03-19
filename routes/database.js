var express = require('express');
var router = express.Router();
var _ = require('lodash');
var path = require('path');
var common = require('./common');
var fs = require('fs');
var archiver = require('archiver');

var backup = require('../mongo/backup');
var restore = require('../mongo/restore');

// runs on all routes and checks password if one is setup
router.all('/db/*', common.checkLogin, function (req, res, next){
    next();
});

// create a new database
router.post('/database/:conn/db_create', function (req, res, next){
    var connection_list = req.app.locals.dbConnections;

    // Check for existance of connection
    if(connection_list[req.params.conn] === undefined){
        res.status(400).json({'msg': req.i18n.__('Invalid connection')});
        return;
    }

    // check for valid DB name
    if(req.body.db_name.indexOf(' ') >= 0 || req.body.db_name.indexOf('.') >= 0){
        res.status(400).json({'msg': req.i18n.__('Invalid database name')});
        return;
    }

    // Get DB form pool
    var mongo_db = connection_list[req.params.conn].native.db(req.body.db_name);

    // adding a new collection to create the DB
    mongo_db.collection('test').save({}, function (err, docs){
        if(err){
            console.error('Error creating database: ' + err);
            res.status(400).json({'msg': req.i18n.__('Error creating database') + ': ' + err});
        }else{
            res.status(200).json({'msg': req.i18n.__('Database successfully created')});
        }
    });
});

// delete a database
router.post('/database/:conn/db_delete', function (req, res, next){
    var connection_list = req.app.locals.dbConnections;

    // Check for existance of connection
    if(connection_list[req.params.conn] === undefined){
        res.status(400).json({'msg': req.i18n.__('Invalid connection')});
    }

    // Get DB form pool
    var mongo_db = connection_list[req.params.conn].native.db(req.body.db_name);

    // delete a collection
    mongo_db.dropDatabase(function (err, result){
        if(err){
            console.error('Error deleting database: ' + err);
            res.status(400).json({'msg': req.i18n.__('Error deleting database') + ': ' + err});
        }else{
            res.status(200).json({'msg': req.i18n.__('Database successfully deleted'), 'db_name': req.body.db_name});
        }
    });
});

// Backup a database
router.post('/database/:conn/:db/db_backup', function (req, res, next){
    var mongodbBackup = require('mongodb-backup');
    var MongoURI = require('mongo-uri');
    var connection_list = req.app.locals.dbConnections;

    // Check for existance of connection
    if(connection_list[req.params.conn] === undefined){
        res.status(400).json({'msg': req.i18n.__('Invalid connection')});
    }

    // get the URI
    var conn_uri = MongoURI.parse(connection_list[req.params.conn].connString);
    var db_name = req.params.db;

    var uri = connection_list[req.params.conn].connString;

    // add DB to URI if not present
    if(!conn_uri.database){
        uri = uri + '/' + db_name;
    }

    // 备份文件夹添加时间格式后缀
    let dbDir = db_name + '-' + formatTime(new Date(), 'yyyyMMddhhmmss');

    // kick off the backup
    backup({uri: uri, dbDir: dbDir, root: path.join(__dirname, '../backups'), callback: function(err){
        if(err){
            console.error('Backup DB error: ' + err);
            res.status(400).json({'msg': req.i18n.__('Unable to backup database')});
        }else{
            res.status(200).json({'msg': req.i18n.__('Database successfully backed up')});

            // 进行zip压缩
            var filePath = path.join(__dirname, '../backups', dbDir);
            archiverZip(filePath);
        }
    }});
});

// Restore a database
router.post('/database/:conn/:db/db_restore', function (req, res, next){
    var MongoURI = require('mongo-uri');
    var connection_list = req.app.locals.dbConnections;
    var dropTarget = false;

    console.log(typeof req.body);

    if('dropTarget' in req.body){
        dropTarget = req.body.dropTarget === 'true';
    }

    // Check for existance of connection
    if(connection_list[req.params.conn] === undefined){
        res.status(400).json({'msg': req.i18n.__('Invalid connection')});
    }

    // get the URI
    var conn_uri = MongoURI.parse(connection_list[req.params.conn].connString);
    var dbDir = req.params.db;
    var db_name = req.params.db.split('-')[0];

    console.log(db_name);

    var uri = connection_list[req.params.conn].connString;

    // add DB to URI if not present
    if(!conn_uri.database){
        uri = uri + '/' + db_name;
    }
    console.log(uri);

    // kick off the restore
    restore({uri: uri, root: path.join(__dirname, '../backups', dbDir), drop: dropTarget, callback: function(err){
        if(err){
            console.error('Restore DB error: ' + err);
            res.status(400).json({'msg': req.i18n.__('Unable to restore database')});
        }else{
            res.status(200).json({'msg': req.i18n.__('Database successfully restored')});
        }
    }});
});

function archiverZip(filePath){
    var output = fs.createWriteStream(filePath + '.zip');
    var arch = archiver('zip', {
        zlib: {level: 9}
    });

    arch.on('end', () => {
        console.log('Data has been drained');
    });

    arch.pipe(output);
    arch.directory(filePath, false);
    arch.finalize();
}

function formatTime(date, fmt){
    const o = {
        'y+': date.getFullYear(),
        'M+': date.getMonth() + 1,                 // 月份
        'd+': date.getDate(),                    // 日
        'h+': date.getHours(),                   // 小时
        'm+': date.getMinutes(),                 // 分
        's+': date.getSeconds(),                 // 秒
        'q+': Math.floor((date.getMonth() + 3) / 3), // 季度
        'S+': date.getMilliseconds()             // 毫秒
    };
    for(const k in o){
        if(new RegExp('(' + k + ')').test(fmt)){
            if(k === 'y+'){
                fmt = fmt.replace(RegExp.$1, ('' + o[k]).substr(4 - RegExp.$1.length));
            }else if(k === 'S+'){
                let lens = RegExp.$1.length;
                lens = lens === 1 ? 3 : lens;
                fmt = fmt.replace(RegExp.$1, ('00' + o[k]).substr(('' + o[k]).length - 1, lens));
            }else{
                fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)));
            }
        }
    }
    return fmt;
}

module.exports = router;
