var http = require('http');
var url = require('url');
var sys = require("sys");
var formidable = require('formidable');
var util = require('util');
var fs = require('fs');
var xml2js = require("xml2js");
var rimraf = require("rimraf");

var HOST = 'localhost';
var PORT = 8080;

var GOOGLE_HOST = 'maps.googleapis.com';
var GOOGLE_PATH = '/maps/api/elevation/json';
var UPLOAD_DIR = 'uploads';

// Clean-up uploads dir
fs.exists(UPLOAD_DIR, function (exists) {
  if (exists) {
	rimraf(UPLOAD_DIR, function(error) {
		if (error) {
			sys.error(error);
		}
	})
  }
})

var server = http.createServer(function (request, response) {
  
  var url_parts = url.parse(request.url, true);
  var location = url_parts.query.where;
  var pathName = url_parts.pathname;
  
  if (location) {
  	handleSimpleElevationRequest(request, response, location);
  	return;
  }
  
  if (pathName == '/uploads' && request.method.toLowerCase() == 'post') {
  	upload_TPX_Data(request, response);
  	return;
  }
  
  if (pathName.indexOf('/uploads') === 0) {
    var file_id = pathName.substring(UPLOAD_DIR.length + 2);
  	show_elevation_data(request, response, file_id);
  	return;
  }
  
  
  display_form(request, response);
  
})

server.listen(PORT, HOST);


// ==============================================================================================

function handleSimpleElevationRequest(request, response, location) {
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
      
      response.writeHead(200, {'Content-Type': 'text/plain'});
      response.write(elevation + '', 'binary');
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

function upload_TPX_Data(req, res) {
	
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

function show_elevation_data(req, res, file_id) {
    sys.debug('Showing file ' + file_id);
	var file_name = req

	var parser = new xml2js.Parser();
	fs.readFile(UPLOAD_DIR + '/' + file_id, function(err, data) {
		if (err) {
			show_error(req, res, 500, 'Error reading file: ' + err);
			return;
		}
				
	    parser.parseString(data, function (err, result) {
	        console.dir(result);
	        console.log('Done');
	        var tcd = result.TrainingCenterDatabase;
	       // res.write('\TCD: ' + util.inspect(tcd));
	        for (var a = 0; a < tcd.Activities.length; a++) {
	        	var activity = tcd.Activities[a].Activity[0];
	        	res.write('\nActivity: ' + activity.Id + " --> " +  util.inspect(activity));
	        	
	        	for (var l = 0; l < activity.Lap.length; l++) {
		        	var lap = activity.Lap[l];
		        	res.write('\Lap: ' + util.inspect(lap));
	       		 }
	        	
	        }
	        
	         res.end();
	    });
	});
}


function display_form(req, res) {
    res.writeHead(200, {"Content-Type": "text/html"});
    res.write('<h1>Velo Eelvation Editor</h1>');
    res.write(
        'Enter GPS coordinates to get Google\'s elevation data.' +
        '<form action="/" method="get">'+
        '<input type="input" name="where" value="Latitude/Longitude">'+
        '<input type="submit" value="Get elevation">'+
        '</form>'
    );
    res.write(
    	'<p>Upload a Garmen TrackPointExtension (.TPX) file to analyze elevation data.</p>'+
        '<form action="/uploads" method="post" enctype="multipart/form-data">'+
        '<input type="file" name="gpsdata">'+
        '<input type="submit" value="Upload">'+
        '</form>'
    );
    res.end();
}


function show_error(request, response, errorCode, message) {
    response.writeHead(errorCode, {'Content-Type': 'text/html'});
    response.write('<title>Error ' + errorCode + '</title>');
    response.write('<p>' + message + '<\p>');
  	response.end();
}


// http://maps.googleapis.com/maps/api/elevation/json?locations=49.31643,-123.137&sensor=true