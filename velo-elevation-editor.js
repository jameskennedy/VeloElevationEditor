var http = require('http');
var url = require('url');
var sys = require("sys");
var formidable = require('formidable');
var util = require('util');
var fs = require('fs');
var xml2js = require("xml2js");

var HOST = 'localhost';
var PORT = 8080;

var GOOGLE_HOST = 'maps.googleapis.com';
var GOOGLE_PATH = '/maps/api/elevation/json';

var server = http.createServer(function (request, response) {

  response.writeHead(200, {'Content-Type': 'text/plain'});
  
  var url_parts = url.parse(request.url, true);
  var location = url_parts.query.where;
  var pathName = url_parts.pathname;
  
  if (location) {
  	handleSimpleElevationRequest(request, response, location);
  	return;
  }
  
  if (request.url == '/upload' && request.method.toLowerCase() == 'post') {
  	process_TPX_Data(request, response);
  	return;
  }
  
  display_form(request, response);
  
})

server.listen(PORT, HOST);

console.log('Server running at http://' + HOST + ':' + PORT + '/');

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

function process_TPX_Data(req, res) {
	var form = new formidable.IncomingForm();

    form.parse(req, function(err, fields, files) {
        res.writeHead(200, {'content-type': 'text/plain'});
	    sys.debug('received upload:\n\n' + util.inspect({fields: fields, files: files}));
      	sys.debug("Reading " + tempFile);
      	
      	var tempFile = files.gpsdata.path;
      	var elevation = [];
      
    	var parser = new xml2js.Parser();
		fs.readFile(tempFile, function(err, data) {
			if (err) {
				res.end('Error reading file: ' + err);
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
    
	   
    });
}


function display_form(req, res) {
    res.writeHead(200, {"Content-Type": "text/html"});
    res.write(
        '<form action="/" method="get">'+
        '<input type="input" name="where" value="Latitude/Longitude">'+
        '<input type="submit" value="Get elevation">'+
        '</form>'
    );
    res.write(
        '<form action="/upload" method="post" enctype="multipart/form-data">'+
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