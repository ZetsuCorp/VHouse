/* VHouse game pages share the existing startup entry requirement. */
(function(){
  "use strict";
  let startupComplete=false;
  try{startupComplete=sessionStorage.getItem("vhouse_startup_ready_v1")==="yes";}catch{}
  const browserReload=performance.getEntriesByType("navigation")
    .some(entry=>entry.type==="reload");
  if(browserReload||!startupComplete)window.location.replace("./startup.html");
})();
