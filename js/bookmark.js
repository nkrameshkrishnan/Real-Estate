// "Send to Home Insight" bookmark (bookmarklet).
// It runs only when the person clicks it, on the listing page they already have open, reads that page's
// visible text and opens this app with it. Nothing is fetched in the background and nothing is sent to a
// server: the text travels in the URL fragment (#…), which browsers never send over the network, and the app
// keeps only the facts it extracts (price, MLS® number, type, size, age, taxes, fees, days on market).
export function bookmarkletHref(appUrl) {
  const src = `(()=>{var a=${JSON.stringify(appUrl)};var t=(document.title+'\\n'+(document.body&&document.body.innerText||'')).slice(0,20000);if(t.length<200){alert('Open a single home listing first, then click Send to Home Insight.');return}var u=a+'#paste='+encodeURIComponent(t)+'&url='+encodeURIComponent(location.href);var w=window.open(u,'_blank');if(!w)location.href=u})()`;
  return 'javascript:' + encodeURIComponent(src);
}
