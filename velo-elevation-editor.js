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

var HOST = 'localhost';
var PORT = 8080;

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
  var location = url_parts.query.where;
  var path_name = url_parts.pathname;
  
  if (location) {
  	handleJSONElevationRequest(request, response, location);
  	return;
  }
  
  // API request of JSON data for file_id
  if (path_name.indexOf('/data/') === 0) {
 	 var file_id = path_name.substring('/data/'.length);
  	 handleJSONDataRequest(request, response, file_id);
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
    form.parse(req, function(err, fields, files) {
	    sys.debug('received upload:\n\n' + util.inspect({fields: fields, files: files}));
      	var tempFile = files.gpsdata.path;
      	var file_id = tempFile.substring(UPLOAD_DIR.length + 1);
      	var file_url = 'http://' +req.headers.host + '/' + UPLOAD_DIR + '/'+file_id;
      	
      	sys.debug('Redirecting to ' + file_url);
      	res.writeHead(301, {'Location': file_url} );
		res.end();
    });
}

// Fetch all relevant data including latitude, longitude, uploaded elevation, 
// and google elevation for the given file_id as a JSON object.
function handleJSONDataRequest(req, res, file_id) {
    sys.debug('Showing file ' + file_id);
	var file_name = path.join(process.cwd(), UPLOAD_DIR, file_id);
	
	if (!fs.existsSync(file_name)) {
  		sys.log("404 Not Found - " + file_name);
        show_error(req,res,404,"404 Not Found");
        return;
	}
	
	var returnData = { latitude:[], longitude:[], uploadElevation:[], googleElevation:[], distance:[] };

	var parser = new xml2js.Parser();
	fs.readFile(file_name, function(err, data) {
		if (err) {
			show_error(req, res, 500, 'Error reading file: ' + err);
			return;
		}
				
	    parser.parseString(data, function (err, result) {
	        var tcd = result.TrainingCenterDatabase;
	        if (!tcd || tcd.Activities.length != 1) {
	          show_error(req, res, 400, "Uploaded file must contain one and only one activity.");
	          return;
	        }
	        
	        var activity = tcd.Activities[0].Activity[0];
	        returnData.activityId = activity.Id;
	       
	        var count = 0;
        	for (var l = 0; l < activity.Lap.length; l++) {
	        	var lap = activity.Lap[l];
	        	var points = lap.Track[0].Trackpoint;
	        	for (var tck = 0; tck < points.length; tck++) {	        		
	        		// Some track points may not have position (e.g. GPS out of range). Ignore.
	        		if (!points[tck].Position) {
	        			continue;
	        		}
	        		returnData.latitude[count] = parseFloat(points[tck].Position[0].LatitudeDegrees);
	        		returnData.longitude[count] = parseFloat(points[tck].Position[0].LongitudeDegrees);
	        		returnData.uploadElevation[count] = parseFloat(points[tck].AltitudeMeters);
	        		returnData.distance[count] = parseFloat(points[tck].DistanceMeters) / 1000;
	        		count++;
	        	}
       		}
       		
       		getGoogleElevations(req, res, returnData, function() {
       			res.writeHead(200, {'Content-Type': 'text/javascript'});
       			res.end(JSON.stringify(returnData));
       		})    		
	    })
	})
}

function getGoogleElevations(request, response, resultData, callback) {
  var index = 0;
  
  var maxLocations = Math.min(MAX_REQUEST_LOCATIONS, resultData.latitude.length);
  
  var points = []; 
  for (var i = 0; i < maxLocations; i++) {
  	points[i] = new PolylineEncoder.latLng(resultData.latitude[i], resultData.longitude[i]);
  }
  
  polylineEncoder = new PolylineEncoder(1,3000,0.000000001);
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
    	
  		show_error(request, response, google_response.statusCode, message);
  		return;
      }
    
      var responseObj = JSON.parse(response_data);
 
      
      for (var i = 0; i < responseObj.results.length; i++) {
        sys.log(responseObj.results[i].elevation);
      	resultData.googleElevation[i] = parseFloat(responseObj.results[i].elevation);
      }
      
      callback();
    });
  });
  
  request.addListener('data', function(chunk) {
  });
  
  request.addListener('end', function() {
    google_request.end();
  });
}



function serve_static_resource(req, res, uri) {
    var filename = path.join(process.cwd(), CLIENT_PATH, uri);
    fs.exists(filename, function(exists) {
        if(!exists) {
        	sys.log("404 Not Found - " + filename);
            show_error(req,res,404,"404 Not Found");
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

//Single coordinate elevation request uses Google API
function handleJSONElevationRequest(request, response, location) {
  if (!location) {
    show_error(request, response, 400, '"where" parameter required. e.g. ' + request.headers.host + request.url + '?where=49.279832,-123.110632');
  	return;
  }
  
  var google = http.createClient(80, GOOGLE_HOST);
  var google_request = google.request('GET', GOOGLE_PATH + '?locations=' + location + '&sensor=true');
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
    	
  		show_error(request, response, google_response.statusCode, message);
  		return;
      }
    
      var responseObj = JSON.parse(response_data);
      var elevation = responseObj.results[0].elevation;
      
      response.writeHead(200, {'Content-Type': 'text/javascript'});
      response.write(elevation + '');
      response.end();
    });
    
    response.writeHead(google_response.statusCode, google_response.headers);
  });
  
  request.addListener('data', function(chunk) {
  });
  
  request.addListener('end', function() {
    google_request.end();
  });
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


function show_error(request, response, errorCode, message) {
	sys.log("Error: " + errorCode + ' - ' + message);
    response.writeHead(errorCode, {'Content-Type': 'text/html'});
    response.write('<title>Error ' + errorCode + '</title>');
    response.write('<p>' + message + '<\p>');
  	response.end();
}


// http://maps.googleapis.com/maps/api/elevation/json?locations=49.31643,-123.137&sensor=true