var sys = require("sys")
var rimraf = require("rimraf")
var fs = require('fs')
var xml2js = require("xml2js")
var path = require('path')

var store = module.exports = {
    UPLOAD_DIR: 'uploads',
    
    parseUpload:    function(file_id, parse_callback) {    
	    var file_name = path.join(process.cwd(), this.UPLOAD_DIR, file_id);
	
	    // Initialize return data-structure
	    var returnData = { file_id:file_id, latitude:[], longitude:[], uploadElevation:[], distance:[]};
	
	    // Include upload meta-data
	    var metadata = this.load_file_info(file_id);
	    returnData.file_name = metadata.name;
	    
	    // Start parsing the TCX XML
	    var parser = new xml2js.Parser();
	    fs.readFile(file_name, function(err, data) {
	        if (err) {
	            parse_callback(err, null);
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
	            
	            parse_callback(null, returnData);
	        })
	    })
	},

	savedProcessedData:    function(file_id, data) {
	    var file_name = path.join(process.cwd(), this.UPLOAD_DIR, file_id + "_parsed");
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
	},
	
	loadProcessedData:    function(file_id, callback) {
	      var file_name = path.join(process.cwd(), this.UPLOAD_DIR, file_id + "_parsed");
	      fs.readFile(file_name, 'utf8', function(err, dataStr) {
	        if (err) {
	          callback(err, null);
	          return;
	        }
            callback(null, JSON.parse(dataStr));
	      });
	},
	
	store_file_info:   function(file_id, file_info) {
	    var meta_file_name = path.join(process.cwd(), this.UPLOAD_DIR, file_id + "_meta");
	    fs.writeFile(meta_file_name, JSON.stringify(file_info), function(err) {
	        if (err) {
	            sys.error('Failed to store file info for upload ' + file_id + '. ' +err);
	        } else {
	            sys.debug('Stored file info for file_id ' + file_id);
	        }
	    }); 
	},
	
	load_file_info:    function(file_id) {
	    var meta_file_name = path.join(process.cwd(), this.UPLOAD_DIR, file_id + "_meta");
	    return JSON.parse(fs.readFileSync(meta_file_name, 'utf8'));
    },
	
	deleteUploadDir:   function() {
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

}