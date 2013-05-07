var sys = require("sys");
var http = require('http');
var polyLine = require("PolylineEncoder");

var google = module.exports = {
    MAX_REQUEST_LOCATIONS:  512, // Google enforced limit}
    GOOGLE_HOST:            'maps.googleapis.com',
    GOOGLE_PATH:            '/maps/api/elevation/json',
    
    getGoogleElevations: function(response, resultData, nextUnfetchedIndex, callback) {
      var maxIndex = Math.min(nextUnfetchedIndex + this.MAX_REQUEST_LOCATIONS, resultData.latitude.length);
      
      sys.debug('Upload ' + resultData.file_id + ': Fetching Google data for points ' + nextUnfetchedIndex + ' to ' + maxIndex);
      
      var points = []; 
      for (var i = nextUnfetchedIndex; i < maxIndex; i++) {
        points.push(new PolylineEncoder.latLng(resultData.latitude[i], resultData.longitude[i]));
      }
      
      polylineEncoder = new PolylineEncoder(18,2,0.000000000001);
      polyline = polylineEncoder.dpEncodeToJSON(points);
    
      var googleClient = http.createClient(80, this.GOOGLE_HOST);
      var google_request = googleClient.request('GET', this.GOOGLE_PATH + '?locations=enc:' + polyline.points + '&sensor=true');
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
            // We recover from this because next call will repeat the points not fetched.
            // There will be a slight skew in the result data though where elevation to point mapping is off by a few
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
}     