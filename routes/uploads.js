var fs = require("fs");
var formidable = require('formidable');
var sys = require("sys");
var url = require('url');
var path = require('path');
var util = require('util');
var lazy = require("lazy")

var google = require("../lib/google");
var store = require("../lib/storage");
var adjustment = require("../lib/adjustment");

/*
 * GET View Upload HTML
 */
exports.index = function(req, res) {
  var file_id = getFiledId(req);
  res.render('view_upload', { title: 'Velo Elevation Editor', file_id: file_id});
};

/*
 * POST upload file
 */
exports.upload = function(req, res) {
  upload_TCX_Data(req, res);
};

/*
 * GET adjusted file (download)
 */
exports.export = function(req, res, next) {
  var file_id = req.query["file_id"];
  var adjust_mode = req.query["adjust_mode"];
  export_adjusted_TCX(res, file_id, adjust_mode, function (err) {
        if (err) {
          next(err);
        }
    }
  )
};

// Fetch all relevant data including latitude, longitude, uploaded elevation, 
// and google elevation for the given file_id as a JSON object.
exports.data = function(req, res, next) {
    var file_id = getFiledId(req);
    var adjust_mode = req.query["adjust_mode"];
    
    loadOrProcessData(res, file_id, function(err, data) {
        if (err) {
            sys.error(util.inspect(err));
            next(err);
            return;
        }
        
        if (!adjustment.do_adjustment(data, adjust_mode)) {
            next(err);
            return;
        }
        
        res.writeHead(200, {'Content-Type': 'text/javascript'});
        res.end(JSON.stringify(data));
    })
}

function getFiledId(req) {
    var url_parts = url.parse(req.url, true);
    var path_name = url_parts.pathname;
    return path_name.substring(path_name.lastIndexOf('/') + 1);
}

function loadOrProcessData(response, file_id, callback) {
    // Verify file was uploaded
    var file_name = path.join(process.cwd(), store.UPLOAD_DIR, file_id);
    if (!fs.existsSync(file_name)) {
        callback('Cannot find file ' + file_id);
        return;
    }
    
    store.loadProcessedData(file_id, function(err, fileData) {
       if (!err) {
            // Used cached parsed/Google data
            callback(null, fileData);
       } else {
           if (err.code != 'ENOENT') {
             sys.error(util.inspect(err));
             callback(err);
             return;
           }
           
           // File not yet parsed, do it now
           processUpload(response, file_id, function(err, returnData) {
               callback(err, returnData);
           });
       }
    })
}

function processUpload(res, file_id, parse_callback) {  

    store.parseUpload(file_id, function(err, data) {  
            if (err) {
             sys.error(util.inspect(err));
             parse_callback(err);
             return;
           }
              
            data.googleElevation = [];          
            var nextUnfetchedIndex = 0;
            var GoogleCallback = function(lastIndexProcessed, returnData) {
               if (lastIndexProcessed >= returnData.latitude.length - 1) {
                    store.savedProcessedData(file_id, data);
                    parse_callback(null, data);
                    return;
                }
                
                nextUnfetchedIndex = Math.min(lastIndexProcessed + 1, returnData.latitude.length);
                google.getGoogleElevations(res, returnData, nextUnfetchedIndex, GoogleCallback);
            }
            
            google.getGoogleElevations(res, data, nextUnfetchedIndex, GoogleCallback);          
    })
}

// Write upload to disk and redirect to /uploads/[file_id]
function upload_TCX_Data(req, res) {
    if (!fs.existsSync(store.UPLOAD_DIR)) {
        fs.mkdirSync(store.UPLOAD_DIR);
    }
    
    var form = new formidable.IncomingForm();
    
    form.uploadDir = store.UPLOAD_DIR;
    form.keepExtensions = false;
    form.parse(req, function(err, fields, files) {
        var tempFile = files.gpsdata.path;
        var file_id = tempFile.substring(store.UPLOAD_DIR.length + 1);

        sys.debug('received upload of file: ' + file_id + ' ' + files.gpsdata.name);
        
        store.store_file_info(file_id, files.gpsdata);
        
        var file_url = 'http://' +req.headers.host + '/' + store.UPLOAD_DIR + '/'+file_id;
        
        sys.debug('Redirecting to ' + file_url);
        res.writeHead(301, {'Location': file_url} );
        res.end();
    });
}

/*
 * GET the original TCX file content but with elevations replaced with
 * adjusted values.
 */
function export_adjusted_TCX(response, file_id, adjust_mode, callback) {
    var latElStart = '<LatitudeDegrees>';
    var latElEnd = '</LatitudeDegrees>';
    var longElStart = '<LongitudeDegrees>';
    var longElEnd = '</LongitudeDegrees>';
    var altStart = '<AltitudeMeters>';
    var altEnd = '</AltitudeMeters>';
            
    loadOrProcessData(response, file_id, function(err, data) {
        if (err) {
            sys.error(util.inspect(err));
            callback(err);
            return;
        }
        
        
        if (!adjustment.do_adjustment(data, adjust_mode)) {
            callback('Invalid adjustment mode paramater.');
            return;
        }
        
        var file_name = path.join(process.cwd(), store.UPLOAD_DIR, file_id);

        var tpIndex = 0;
        var lastLat = null;
        var lastLong = null;
        var replacementCount = 0;
        
        var wroteHeader = false;
        new lazy(fs.createReadStream(file_name)).lines.forEach(function(line){
            if (!wroteHeader) {
                response.writeHead(200, {'Content-Type': 'application/tcx+xml'});
                wroteHeader = true;
            }
            
            var line = line.toString();
            if (line.indexOf('<Trackpoint>') != -1) {
                // Don't advanced index for track-points with no position
                if (lastLat != null && lastLong != null) {
                    tpIndex++;
                }
                
                lastLat = null;
                lastLong = null;
            } else if (line.indexOf(latElStart) != -1) {
                var value = line.substring(line.indexOf(latElStart) + latElStart.length, line.indexOf(latElEnd));
                lastLat = parseFloat(value);
            } else if (line.indexOf(longElStart) != -1) {
                var value = line.substring(line.indexOf(longElStart) + longElStart.length, line.indexOf(longElEnd));
                lastLong = parseFloat(value);
            } else if (line.indexOf(altStart) != -1) {
                var value = line.substring(line.indexOf(altStart) + altStart.length, line.indexOf(altEnd));
                var elevation = value;
                
                var dataLat = data.latitude[tpIndex];
                var dataLong = data.longitude[tpIndex];
                var dataElevation = data.uploadElevation[tpIndex];
                
                if (dataLat === lastLat && dataLong === lastLong && parseFloat(dataElevation) == elevation) {
                    var newElevation = data.adjustedElevation[tpIndex];
                    var replacedLine = line.replace(elevation, newElevation);
                    response.write(replacedLine + "\n");
                    replacementCount++;
                    return;
                }
            }
            
            response.write(line.toString() + "\n");
        }).join(function() {
            sys.debug('Exported file ' + file_id + ' with ' + replacementCount + ' adjustments.');
            response.end();
        });
    })
}