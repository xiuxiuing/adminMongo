'use strict';

var BSON, logger, meta, systemRegex = /^system\./, fs = require('graceful-fs'), path = require('path');

function error(err){
    err && logger(err.message);
}

function writeMetadata(collection, metadata, next){
    return collection.indexes(function(err, indexes){
        if(err)return next(err);
        fs.writeFile(metadata + collection.collectionName, JSON.stringify(indexes), next);
    });
}

function makeDir(pathname, next){
    fs.stat(pathname, function(err, stats){
        return err && err.code === 'ENOENT' ? (logger('make dir at ' + pathname), fs.mkdir(pathname, function(err){
            next(err, pathname);
        })) : stats && !1 === stats.isDirectory() ? (logger('unlink file at ' + pathname),
            fs.unlink(pathname, function(err){
                if(err)return next(err);
                logger('make dir at ' + pathname), fs.mkdir(pathname, function(err){
                    next(err, pathname);
                });
            })) : void next(null, pathname);
    });
}

function rmDir(pathname, next){
    fs.readdirSync(pathname).forEach(function(first){
        var database = pathname + first;
        if(!1 === fs.statSync(database).isDirectory())return next(Error('path is not a Directory'));
        var metadata = '', collections = fs.readdirSync(database), metadataPath = path.join(database, '.metadata');
        return!0 === fs.existsSync(metadataPath) && (metadata = metadataPath + path.sep,
            delete collections[collections.indexOf('.metadata')]), collections.forEach(function(second){
                var collection = path.join(database, second);
                !1 !== fs.statSync(collection).isDirectory() && (fs.readdirSync(collection).forEach(function(third){
                    var document = path.join(collection, third);
                    return fs.unlinkSync(document), next ? next(null, document) : '';
                }), metadata !== '' && fs.unlinkSync(metadata + second), fs.rmdirSync(collection));
            }), metadata !== '' && fs.rmdirSync(metadata), fs.rmdirSync(database);
    });
}

function toJsonAsync(doc, collectionPath){
    fs.writeFile(collectionPath + doc._id + '.json', JSON.stringify(doc));
}

function toBsonAsync(doc, collectionPath){
    fs.writeFile(collectionPath + doc._id + '.bson', BSON.serialize(doc));
}

function allCollections(db, name, query, metadata, parser, next){
    return db.collections(function(err, collections){
        if(err)return next(err);
        var last = ~~collections.length, index = 0;
        if(last === 0)return next(err);
        collections.forEach(function(collection){
            if(!0 === systemRegex.test(collection.collectionName))return last === ++index ? next(null) : null;
            logger('select collection ' + collection.collectionName), makeDir(name + collection.collectionName + path.sep, function(err, name){
                if(err)return last === ++index ? next(err) : error(err);
                meta(collection, metadata, function(){
                    collection.find({$query: query, $snapshot: true}).stream().once('end', function(){
                        return last === ++index ? next(null) : null;
                    }).on('data', function(doc){
                        parser(doc, name);
                    });
                });
            });
        });
    });
}

function allCollectionsScan(db, name, numCursors, metadata, parser, next){
    return db.collections(function(err, collections){
        if(err)return next(err);
        var last = ~~collections.length, index = 0;
        if(last === 0)return next(null);
        collections.forEach(function(collection){
            if(!0 === systemRegex.test(collection.collectionName))return last === ++index ? next(null) : null;
            logger('select collection scan ' + collection.collectionName), makeDir(name + collection.collectionName + path.sep, function(err, name){
                if(err)return last === ++index ? next(err) : error(err);
                meta(collection, metadata, function(){
                    collection.parallelCollectionScan({
                        numCursors: numCursors
                    }, function(err, cursors){
                        if(err)return last === ++index ? next(err) : error(err);
                        var ii, cursorsDone;
                        if((ii = cursorsDone = ~~cursors.length) === 0)return last === ++index ? next(null) : null;
                        for(var i = 0; i < ii; ++i){
                            cursors[i].once('end', function(){
                                if(--cursorsDone == 0)return last === ++index ? next(null) : null;
                            }).on('data', function(doc){
                                parser(doc, name);
                            });
                        }
                    });
                });
            });
        });
    });
}

function someCollections(db, name, query, metadata, parser, next, collections){
    var last = ~~collections.length, index = 0;
    if(last === 0)return next(null);
    collections.forEach(function(collection){
        db.collection(collection, {
            strict: !0
        }, function(err, collection){
            if(err)return last === ++index ? next(err) : error(err);
            logger('select collection ' + collection.collectionName), makeDir(name + collection.collectionName + path.sep, function(err, name){
                if(err)return last === ++index ? next(err) : error(err);
                meta(collection, metadata, function(){
                    collection.find(query).snapshot(!0).stream().once('end', function(){
                        return last === ++index ? next(null) : null;
                    }).on('data', function(doc){
                        parser(doc, name);
                    });
                });
            });
        });
    });
}

function someCollectionsScan(db, name, numCursors, metadata, parser, next, collections){
    var last = ~~collections.length, index = 0;
    if(last === 0)return next(null);
    collections.forEach(function(collection){
        db.collection(collection, {
            strict: !0
        }, function(err, collection){
            if(err)return last === ++index ? next(err) : error(err);
            logger('select collection scan ' + collection.collectionName), makeDir(name + collection.collectionName + path.sep, function(err, name){
                if(err)return last === ++index ? next(err) : error(err);
                meta(collection, metadata, function(){
                    collection.parallelCollectionScan({
                        numCursors: numCursors
                    }, function(err, cursors){
                        if(err)return last === ++index ? next(err) : error(err);
                        var ii, cursorsDone;
                        if((ii = cursorsDone = ~~cursors.length) === 0)return last === ++index ? next(null) : null;
                        for(var i = 0; i < ii; ++i){
                            cursors[i].once('end', function(){
                                if(--cursorsDone == 0)return last === ++index ? next(null) : null;
                            }).on('data', function(doc){
                                parser(doc, name);
                            });
                        }
                    });
                });
            });
        });
    });
}

function wrapper(my){
    var parser;
    if(typeof my.parser === 'function') parser = my.parser; else{
        switch(my.parser.toLowerCase()){
        case'bson':
            BSON = new (BSON = require('bson'))(), parser = toBsonAsync;
            break;

        case'json':
            parser = toJsonAsync;
            break;

        default:
            throw new Error('missing parser option');
        }
    }
    var discriminator = allCollections;
    if(my.collections !== null ? (discriminator = someCollections, my.numCursors && (discriminator = someCollectionsScan,
        my.query = my.numCursors)) : my.numCursors && (discriminator = allCollectionsScan,
        my.query = my.numCursors), my.logger === null) logger = function(){}; else{
        (logger = require('logger-request')({
            filename: my.logger,
            standalone: !0,
            daily: !0,
            winston: {
                logger: '_mongo_b' + my.logger,
                level: 'info',
                json: !1
            }
        }))('backup start');
        var log = require('mongodb').Logger;
        log.setLevel('info'), log.setCurrentLogger(function(msg){
            return logger(msg);
        });
    }
    var metadata = '';
    function callback(err){
        logger('backup stop'), my.callback !== null ? (logger('callback run'), my.callback(err)) : err && logger(err);
    }
    meta = !0 === my.metadata ? writeMetadata : function(a, b, c){
        return c();
    }, require('mongodb').MongoClient.connect(my.uri, my.options, function(err, db){
        if(logger('db open'), err)return callback(err);
        var root = my.tar === null ? my.root : my.dir;
        makeDir(root, function(err, name){
            if(err)return callback(err);
            makeDir(name + my.dbDir + path.sep, function(err, name){
                function go(){
                    return discriminator(db, name, my.query, metadata, parser, function(err){
                        if(logger('db close'), db.close(), err)return callback(err);
                        my.tar ? makeDir(my.root, function(e, name){
                            var dest;
                            err && error(err), my.stream ? (logger('send tar file to stream'), dest = my.stream) : (logger('make tar file at ' + name + my.tar),
                                dest = fs.createWriteStream(name + my.tar));
                            var packer = require('tar').Pack().on('error', callback).on('end', function(){
                                rmDir(root), callback(null);
                            });
                            require('fstream').Reader({
                                path: root + my.dbDir,
                                type: 'Directory'
                            }).on('error', callback).pipe(packer).pipe(dest);
                        }) : callback(null);
                    }, my.collections);
                }
                if(err)return callback(err);
                !1 === my.metadata ? go() : makeDir(metadata = name + '.metadata' + path.sep, go);
            });
        });
    });
}

function backup(options){
    var opt = options || Object.create(null);
    console.log(opt.uri);
    if(!opt.uri)throw new Error('missing uri option');
    if(!opt.stream){
        if(!opt.root)throw new Error('missing root option');
        if(fs.existsSync(opt.root) && !fs.statSync(opt.root).isDirectory())throw new Error('root option is not a directory');
    }
    var my = {
        dir: path.join(__dirname, 'dump', path.sep),
        uri: String(opt.uri),
        dbDir: opt.dbDir,
        root: path.resolve(String(opt.root || '')) + path.sep,
        stream: opt.stream || null,
        parser: opt.parser || 'bson',
        numCursors: ~~opt.numCursors,
        collections: Array.isArray(opt.collections) ? opt.collections : null,
        callback: typeof opt.callback === 'function' ? opt.callback : null,
        tar: typeof opt.tar === 'string' ? opt.tar : null,
        query: typeof opt.query === 'object' ? opt.query : {},
        logger: typeof opt.logger === 'string' ? path.resolve(opt.logger) : null,
        options: typeof opt.options === 'object' ? opt.options : {},
        metadata: Boolean(opt.metadata)
    };
    return my.stream && (my.tar = !0), wrapper(my);
}

module.exports = backup;
