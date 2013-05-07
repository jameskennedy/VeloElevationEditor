var http = require('http');
var url = require('url');
var sys = require("sys");
var path = require('path')
var formidable = require('formidable');
var util = require('util');
var fs = require('fs');
var xml2js = require("xml2js");
var rimraf = require("rimraf");
var polyLine = require("./PolylineEncoder");
var lazy = require("lazy");

var HOST = 'localhost';
var PORT = 8081;

var GOOGLE_HOST = 'maps.googleapis.com';
var GOOGLE_PATH = '/maps/api/elevation/json';
var MAX_REQUEST_LOCATIONS = 512; // Google enforced limit
var UPLOAD_DIR = 'uploads';
var CLIENT_PATH = 'client';

var mimeTypes = {
    "html": "text/html",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "js": "text/javascript",
    "css": "text/css",
    "tcx": "application/xml"};


// Wipe previous upload data on startup - DISABLED for testing
// deleteUploadDir(); 

var server = http.createServer(function (request, response) {
  
  var url_parts = url.parse(request.url, true);
  var path_name = url_parts.pathname;
  
  var adjust_mode = url_parts.query['adjust_mode'];
  if ((adjust_mode + '') == '[object Event]') {
	 adjust_mode = null;
  }
  
  // API request of JSON data for file_id
  if (path_name.indexOf('/data/') === 0) {
 	 var file_id = path_name.substring('/data/'.length);
 	 
  	 handleJSONDataRequest(request, response, file_id, adjust_mode);
  	 return;
  }
  
  // Handle file upload and external redirect to /uploads/[file_id]
  if (path_name === '/uploads' && request.method.toLowerCase() == 'post') {
  	upload_TCX_Data(request, response);
  	return;
  }
  
  // Internal redirect for /uploads/[file_id]
  if (path_name.indexOf('/uploads/') === 0) {
	path_name = '/view_upload.html';
  }
  
  // File export
  if (path_name.indexOf('/export/') === 0) {
	  var file_id = url_parts.query.file_id;
	  sys.debug("Exporting file " + file_id + " with adjust mode " + adjust_mode);
	  export_adjusted_TCX(response, file_id, adjust_mode);
	  return;
  }
  
  // Default page
  if (!path_name || path_name == '/') {
	path_name = '/index.html';
  }
  
  serve_static_resource(request, response, path_name);
  
})

server.listen(PORT, HOST);


// =============================================================================================

// Write upload to disk and redirect to /uploads/[file_id]
function upload_TCX_Data(req, res) {
	
	if (!fs.existsSync(UPLOAD_DIR)) {
  		fs.mkdirSync(UPLOAD_DIR);
	}
	
	var form = new formidable.IncomingForm();
	
	form.uploadDir = UPLOAD_DIR;
	form.keepExtensions = false;
    form.parse(req, function(err, fields, files) {
      	var tempFile = files.gpsdata.path;
      	var file_id = tempFile.substring(UPLOAD_DIR.length + 1);

	    sys.debug('received upload of file: ' + file_id + ' ' + files.gpsdata.name);
      	
      	store_meta_data(file_id, files.gpsdata);
      	
      	var file_url = 'http://' +req.headers.host + '/' + UPLOAD_DIR + '/'+file_id;
      	
      	sys.debug('Redirecting to ' + file_url);
      	res.writeHead(301, {'Location': file_url} );
		res.end();
    });
}

function store_meta_data(file_id, file_info) {
	var meta_file_name = path.join(process.cwd(), UPLOAD_DIR, file_id + "_meta");
    fs.writeFile(meta_file_name, JSON.stringify(file_info), function(err) {
	    if (err) {
	        sys.error('Failed to store metadata for upload ' + file_id + '. ' +err);
	    } else {
	        sys.debug('Stored metadata for file ' + file_id);
	    }
    }); 
}

function load_meta_data(file_id) {
	var meta_file_name = path.join(process.cwd(), UPLOAD_DIR, file_id + "_meta");
	return JSON.parse(fs.readFileSync(meta_file_name, 'utf8'));
}

// Fetch all relevant data including latitude, longitude, uploaded elevation, 
// and google elevation for the given file_id as a JSON object.
function handleJSONDataRequest(req, res, file_id, adjust_mode) {
	loadOrParseData(res, file_id, function(err, data) {
		if (err) {
	        sys.error(util.inspect(err));
			show_error(res, 501, 'Internal error attempting to read parsed upload.');
			return;
		}
		
		if (!doAdjustment(res, data, adjust_mode)) {
			return;
		}
		
        res.writeHead(200, {'Content-Type': 'text/javascript'});
        res.end(JSON.stringify(data));
    })
}

function loadOrParseData(response, file_id, callback) {
	// Verify file was uploaded
	var file_name = path.join(process.cwd(), UPLOAD_DIR, file_id);
	if (!fs.existsSync(file_name)) {
  		callback('404 - Not an upload: ' + file_id);
        return;
	}
	
	loadParsedData(file_id, function(err, dataString) {
	   if (!err) {
	        // Used cached parsed/Google data
	        var data = JSON.parse(dataString);
	        callback(null, data);
	   } else {
	       if (err.code != 'ENOENT') {
	         sys.error(util.inspect(err));
	         callback(err);
	         return;
	       }
	       
	       // File not yet parsed, do it now
	       parseUpload(response, file_id, function(returnData) {
	    	   callback(null, returnData);
	       });
	   }
	})
}

function parseUpload(res, file_id, parse_callback) {	
    var file_name = path.join(process.cwd(), UPLOAD_DIR, file_id);

	// Initialize return data-structure
	var returnData = { file_id:file_id, latitude:[], longitude:[], uploadElevation:[], googleElevation:[], distance:[]};

	// Include upload meta-data
	var metadata = load_meta_data(file_id);
	returnData.file_name = metadata.name;
	
    // Start parsing the TCX XML
	var parser = new xml2js.Parser();
	fs.readFile(file_name, function(err, data) {
		if (err) {
			show_error(res, 500, 'Error reading file: ' + err);
			return;
		}
				
	    parser.parseString(data, function (err, result) {
	        var tcd = result.TrainingCenterDatabase;
	        if (!tcd || tcd.Activities.length != 1) {
	          show_error(res, 400, "Uploaded file must contain one and only one activity.");
	          return;
	        }
	        
	        // Extract data for a single activity
	        var activity = tcd.Activities[0].Activity[0];
	        returnData.activityId = activity.Id;
	        var count = 0;
        	for (var l = 0; l < activity.Lap.length; l++) {
	        	var lap = activity.Lap[l];
	        	var points = lap.Track[0].Trackpoint;
	        	// sys.debug("Lap " + l + " Points: " + points.length);
	        	for (var tck = 0; tck < points.length; tck++) {	        		
	        		// Some track points may not have position (e.g. GPS out of range). Ignore.
	        		if (!points[tck].Position) {
	        			continue;
	        		}
	        		returnData.latitude[count] = parseFloat(points[tck].Position[0].LatitudeDegrees);
	        		returnData.longitude[count] = parseFloat(points[tck].Position[0].LongitudeDegrees);
	        		returnData.uploadElevation[count] = parseFloat(points[tck].AltitudeMeters);
	        		returnData.distance[count] = parseFloat(points[tck].DistanceMeters) / 1000;
	        		
                    // sys.debug("Lap " + l + " Point: " + tck + ' ' + util.inspect(returnData.latitude[count] + ', ' + returnData.longitude[count]));
	        		count++;
	        	}
       		}
       		
       		var nextUnfetchedIndex = 0;
       		var GoogleCallback = function(lastIndexProcessed, returnData) {
               if (lastIndexProcessed >= returnData.latitude.length - 1) {
                    savedParsedData(file_id, returnData);
                    parse_callback(returnData);
                    return;
                }
                
                nextUnfetchedIndex = Math.min(lastIndexProcessed + 1, returnData.latitude.length);
                getGoogleElevations(res, returnData, nextUnfetchedIndex, GoogleCallback);
            }
            
       		getGoogleElevations(res, returnData, nextUnfetchedIndex, GoogleCallback);  		
	    })
	})
}

function getGoogleElevations(response, resultData, nextUnfetchedIndex, callback) {
  var maxIndex = Math.min(nextUnfetchedIndex + MAX_REQUEST_LOCATIONS, resultData.latitude.length);
  
  sys.debug('Upload ' + resultData.file_id + ': Fetching Google data for points ' + nextUnfetchedIndex + ' to ' + maxIndex);
  
  var points = []; 
  for (var i = nextUnfetchedIndex; i < maxIndex; i++) {
  	points.push(new PolylineEncoder.latLng(resultData.latitude[i], resultData.longitude[i]));
  }
  
  polylineEncoder = new PolylineEncoder(18,2,0.000000000001);
  polyline = polylineEncoder.dpEncodeToJSON(points);

  var google = http.createClient(80, GOOGLE_HOST);
  var google_request = google.request('GET', GOOGLE_PATH + '?locations=enc:' + polyline.points + '&sensor=true');
  var response_data = '';
  
  google_request.addListener('response', function (google_response) {
    google_response.addListener('data', function(chunk) {
   	    response_data += chunk;
    });
    
    google_response.addListener('end', function() {
      if (200 != google_response.statusCode) {
      	var message = '<p>An unkown error occured.</p>';
      	
    	if (google_response.statusCode == 400) {
    		message = '<p>Input parameters are invalid.</p>';
    	}
    	
    	sys.error("Google response error: " + google_response.statusCode);
  		show_error(response, google_response.statusCode, message);
  		return;
      }
    
      var responseObj = JSON.parse(response_data);
      var googlePointCount = responseObj.results.length;
      
      sys.debug("Got a 200 OK response from google with " +  googlePointCount + ' points.');
 
     if (googlePointCount != points.length) {
        sys.error('ERROR: Unexpected state: Sent ' + points.length + ' points to Google but got back ' + googlePointCount);
        //show_error(response, 501, "My apologies, server error.");
        //return;
      }
      
      for (var i = 0; i < googlePointCount; i++) {
        var index = nextUnfetchedIndex + i;
      	resultData.googleElevation[index] = parseFloat(responseObj.results[i].elevation);
      	maxIndex = index;
      }
      
      callback(maxIndex, resultData);
    });
  });
  
  google_request.end(); 
  
}

function doAdjustment(response, data, adjust_mode) {
	// Default
	if (!adjust_mode) {
		adjust_mode = 'FixedBestFit';
	}
	
	if (adjust_mode == 'UseGoogle') {
		data.adjustedElevation = data.googleElevation;
	} else if (adjust_mode == 'FixedBestFit') {
		fixedShiftAdjustment(data, 0, data.latitude.length - 1);
	} else if (adjust_mode == 'FixedBestFitPartition') {
		fixedShiftPartitionedAdjustment(data);
	} else {
		show_error(response, 400, 'Invalid adjustment mode paramater.');
		return false;
	}
	
	return true;
}

function fixedShiftPartitionedAdjustment(data) {
    var start = 0;
    var end = 0;
    
    var lastDistance = data.distance[0];
    var lastElevation = data.uploadElevation[0];
    var samePointStart = null;
    
    for (end = 1; end < data.uploadElevation.length; end++) {
        var distance = data.distance[end];
        var elevation = data.uploadElevation[end];
        
        var distanceDelta = (distance - lastDistance) * 1000; //km > m
        var elevationDelta = elevation - lastElevation;
        
        lastDistance = distance;
        lastElevation = elevation;
        
        if (!distanceDelta) {    
            
            if (Math.abs(elevationDelta) < 5) {
                continue;
            }
            
                    
            if (!samePointStart) {
                samePointStart = end;
                sys.debug("Same point elevation discrepancy of " + elevationDelta + "m at " + distance + "km, partitioning");
                fixedShiftAdjustment(data, start, end - 1);
                start = end;
            }

        } else {      
            //TODO: This is supposing that distance has been recorded via bike sensor and not GPS  
            var horizDistance = Math.sqrt(Math.pow(distanceDelta,2) - Math.pow(elevationDelta,2));
	        var grade = 100 * elevationDelta / horizDistance;
	        if (grade > 40 || grade < -60) {
	            sys.debug("Suspicious grade of " + grade + " at " + distance + "km, v. delta " + elevationDelta +"m, h. delta " + distanceDelta + ", partitioning");
	            fixedShiftAdjustment(data, start, end - 1);
	            start = end;
	        }
            
            samePointStart = null;
	    }
    }
    
    fixedShiftAdjustment(data, start, data.uploadElevation.length - 1);
}

function fixedShiftAdjustment(data, start, end, bias) {
    if (start > end) {
      return;
    }

    // Initialize adjustment data
    if (!data.adjustedElevation) {
        data.adjustedElevation = [];
        data.elevationDelta = [];
        for (var i = 0; i < start; i++) {
            data.adjustedElevation[i] = data.uploadElevation[i];
            data.elevationDelta[i] = 0;
        }
        for (var i = end + 1; i < data.uploadElevation.length; i++) {
            data.adjustedElevation[i] = data.uploadElevation[i];
            data.elevationDelta[i] = 0;
        }
    }
    
    var maxDeltaIndex = 0;
    var inclusionGroup = [];
    var maxInclusion = Math.max(1, Math.round((end - start) * 0.25));
    for (var i = start; i <= end; i++) {
    	var inclusionIndex = i - start;
        var delta = data.googleElevation[i] - data.uploadElevation[i];
        data.elevationDelta[i] = delta;
        
        if (inclusionIndex < maxInclusion) {
        	inclusionGroup.push(delta);
            if (Math.abs(delta) > Math.abs(inclusionGroup[maxDeltaIndex])) {
            	maxDeltaIndex = inclusionIndex;
            }
            
        } else {
        	if (Math.abs(delta) < Math.abs(inclusionGroup[maxDeltaIndex])) {
	        	inclusionGroup[maxDeltaIndex] = delta;
	        	for (var j = 0; j < maxInclusion; j++) {
	        		if (Math.abs(inclusionGroup[j]) > Math.abs(inclusionGroup[maxDeltaIndex])) {
	                	maxDeltaIndex = j;
	                }
	        	}
        	}
        }
    }
    
    // sys.debug(util.inspect(inclusionGroup));
    
    var cummulativeDelta = 0;
    for (var i = 0; i < maxInclusion; i++) {
    	cummulativeDelta += inclusionGroup[i];
    } 

    var fixedAdjustment = cummulativeDelta / maxInclusion;
    if (bias) {
        fixedAdjustment += bias;
    }
    
    sys.debug("Fixed adjustment: From " + start + ":" +  data.distance[start] + " to " + end + ":" + data.distance[end] + " shifted " + fixedAdjustment + "m using " + maxInclusion + " min delta points");
    for (var i = start; i <= end; i++) {
    	data.adjustedElevation[i] = data.uploadElevation[i] + fixedAdjustment;
    } 
}

/*
 * Return the original TCX file content but with elevations replaced with
 * adjusted values.
 */
function export_adjusted_TCX(response, file_id, adjust_mode) {
	var latElStart = '<LatitudeDegrees>';
	var latElEnd = '</LatitudeDegrees>';
	var longElStart = '<LongitudeDegrees>';
	var longElEnd = '</LongitudeDegrees>';
	var altStart = '<AltitudeMeters>';
	var altEnd = '</AltitudeMeters>';
	
	loadOrParseData(response, file_id, function(err, data) {
		if (err) {
	        sys.error(util.inspect(err));
			show_error(response, 501, 'Internal error attempting to read parsed upload.');
			return;
		}
		
		if (!doAdjustment(response, data, adjust_mode)) {
			return;
		}
		
		var file_name = path.join(process.cwd(), UPLOAD_DIR, file_id);

		var tpIndex = 0;
		var lastLat = null;
		var lastLong = null;
		var replacementCount = 0;
		
		var wroteHeader = false;
		new lazy(fs.createReadStream(file_name)).lines.forEach(function(line){
			if (!wroteHeader) {
				response.writeHead(200, {'Content-Type': 'application/xml'});
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
					response.write(replacedLine);
					replacementCount++;
					return;
			    }
			}
			
			response.write(line.toString());
		}).join(function() {
			sys.debug('Exported file ' + file_id + ' with ' + replacementCount + ' adjustments.');
			response.end();
		});
    })
}

function serve_static_resource(req, res, uri) {
    var filename = path.join(process.cwd(), CLIENT_PATH, uri);
    fs.exists(filename, function(exists) {
        if(!exists) {
        	sys.log("404 Not Found - " + filename);
            show_error(res,404,"404 Not Found");
            return;
        }
        
        
        var extension = path.extname(filename).split(".")[1];
        var mimeType = mimeTypes[extension.toLowerCase()];

        sys.log("Serving file: " + filename + ' with mime/type ' + mimeType);
        res.writeHead(200, mimeType);

        var fileStream = fs.createReadStream(filename);
        fileStream.pipe(res);
        return fileStream;
    });
}

function savedParsedData(file_id, data) {
    var file_name = path.join(process.cwd(), UPLOAD_DIR, file_id + "_parsed");
    if (fs.existsSync(file_name)) {
        fs.truncateSync(file_name, 0);
    }
    
    fs.writeFile(file_name, JSON.stringify(data), function(err) {
	    if (err) {
	        sys.error('Failed to cache parsed data for upload ' + file_id + '. ' +err);
	    } else {
	        sys.debug('Cached parsed data for file ' + file_id);
	    }
    }); 
}

function loadParsedData(file_id, callback) {
      var file_name = path.join(process.cwd(), UPLOAD_DIR, file_id + "_parsed");
      fs.readFile(file_name, 'utf8', callback);
}

function deleteUploadDir() {
	fs.exists(UPLOAD_DIR, function (exists) {
	  if (exists) {
		rimraf(UPLOAD_DIR, function(error) {
			if (error) {
				sys.error(error);
			}
		})
	  }
	})
}


function show_error(response, errorCode, message) {
	sys.log("Error: " + errorCode + ' - ' + message);
    response.writeHead(errorCode, {'Content-Type': 'text/html'});
    response.write('<title>Error ' + errorCode + '</title>');
    response.write('<p>' + message + '<\p>');
  	response.end();
}


// http://maps.googleapis.com/maps/api/elevation/json?locations=49.31643,-123.137&sensor=true