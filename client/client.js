function initialize() {
  var myLatLng = new google.maps.LatLng(0, -180);
  var mapOptions = {
    zoom: 3,
    center: myLatLng,
    mapTypeId: google.maps.MapTypeId.TERRAIN
  };

  var map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions);

  var flightPlanCoordinates = [
      new google.maps.LatLng(37.772323, -122.214897),
      new google.maps.LatLng(21.291982, -157.821856),
      new google.maps.LatLng(-18.142599, 178.431),
      new google.maps.LatLng(-27.46758, 153.027892)
  ];
  var flightPath = new google.maps.Polyline({
    path: flightPlanCoordinates,
    strokeColor: '#FF0000',
    strokeOpacity: 1.0,
    strokeWeight: 2
  });

  flightPath.setMap(map);
}

google.maps.event.addDomListener(window, 'load', initialize);
