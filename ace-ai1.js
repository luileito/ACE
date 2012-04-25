/*!
 * ACE: An Adaptive CSS Engine for Web Pages and Web-based Applications.
 * Luis A. Leiva. In Proc. WWW Dev Track, 2012.
 * Released under the MIT license: http://www.opensource.org/licenses/MIT
 */
;(function(window, document){
  "use strict";

  var prevRank = {};  // will be parsed on loading ACE  
  var evRank = {};    // event ranking
  var evCount = 0;    // event count
  
  /**
   * Auxiliary functions.
   * A bunch of utilities to rank interacted elements, manipulate colors, etc.
   */
  var fn = {  
    /** 
     * Find interacted DOM element.
     * The result is a XPath string representing the position of element in the DOM.
     * @param {object}  e Event.
     * @return {string}
     */
    findElement: function(e) {
      e = e || window.event;
      // find the element
      var t = e.target || e.srcElement;
      // defeat Safari bug
      if (t.nodeType == 3) { t = t.parentNode; }
      
      return xpath.getXPath(t);
    },    
    /** 
     * Update interacted ranks.
     * @param {object}  e Event.
     * @return void
     */
    updateRank: function(e) {
      e = e || window.event;
      // get a serialized representation of the interacted element
      var elem = this.findElement(e);    
      // check ranks
      if (!evRank[elem]) evRank[elem] = {};
      if (!evRank[elem][e.type]) evRank[elem][e.type] = 0;
      // update 
      evRank[elem][e.type]++;
      evCount++;
    },
    /** 
     * Application unload routines.
     * @return void     
     */
    saveRank: function() {
      // compute difference between current and previous data
      var newRank = fn.fuseRank(evRank);
      var diff = fn.diffRank(newRank, prevRank);
      // serialize data and store on DB
      db.set("ace-rank", JSON.stringify(diff));
    },    
    /** 
     * Fuse all event rankings for each tracked element. 
     * @param {object} rank Event ranking.
     * @return {object}     Fused ranking.
     */
    fuseRank: function(rank) {
      var oList = {}, evts, mean, w, n;
      // normalize weights, so that their sum is 1
      var sum = 0;
      for (var p in events.config.priorities) {
        sum += events.config.priorities[p];
      }
      // then compute the weighted mean
      for (var elem in rank) {
        evts = rank[elem];
        mean = n = 0;
        for (var ev in evts) {
          w = events.config.priorities[ev]/sum;
          mean += evts[ev] * w;
          n++;
        }
        oList[elem] = fn.sigmoid(mean/evCount, n);
      }

      return oList;
    },
    /** 
     * Apply a sigmoid function to given value.
     * @param {float} value         Input value.
     * @param {float} [multiplier]  Weighting value; default: 1.
     * @return {float}
     */
    sigmoid: function(value, multiplier) {
      // smooth values: the more the number of different event types (triggered for the same element) the smoother
      multiplier = multiplier || 1;
      return this.sinh(value * multiplier);
    },
    /** 
     * Compute the hyperbolic sinus of given value.
     * @param {float} value Input value.
     * @return {float}
     */
    sinh: function(value) {
      var r = Math.exp(value);
      return (r - 1/r) / 2;
    },
    /** 
     * Compute the hyperbolic tangent of given value.
     * Alternative to use in sigmoid() method.
     * @param {float} value Input value.
     * @return {float}     
     */    
    tanh: function(value) {
      return 1 - 2 / (Math.exp(2 * value) + 1);
    },        
    /** 
     * Compute the different between two ranks.
     * @param {object} newRank Current rank of interacted elements.
     * @param {object} oldRank Previous rank, on DB.
     * @return {object}
     */    
    diffRank: function(newRank, oldRank) {
      var rank = {};
      var value;
      // iterating over newRank will preserve only new interacted elements
      for (var elem in newRank) {
        value = newRank[elem];
        if (oldRank && oldRank[elem]) {
          value -= oldRank[elem];
        }
        rank[elem] = value;
      }
      
      return rank;
    },
    /** 
     * Restyles a CSS property of given DOM element according to a computed weight.
     * @param {object}  domElem DOM element to restyle.
     * @param {string}  cssProp CSS property.
     * @param {float}   weight  Weight to restyle the CSS properties of DOM element.
     * @return void
     */    
    restyle: function(domElem, cssProp, weight) {
      var cssValue = this.getStyle(domElem, cssProp);
      // exit if CSS property is not accesible
      if (!cssValue) return; 
      var newCssVal = "";
      if (/color/.test(cssProp)) {
        // deal with color properties
        var rgb = this.parseColor(cssValue);
        newCssVal = this.cssColorAdapt(rgb, weight);
      } else if (/[0-9]+/.test(cssValue)) { 
        // deal with numerical values (margins, paddings, etc.)
        var dim = this.parseDimension(cssValue);
        newCssVal = this.cssDimensionAdapt(dim.value, weight) + dim.unit;
      } else {
        //TODO: map strings to numbers, e.g., "bold" => 900?
        newCssVal = cssValue;
      }
      this.setStyle(domElem, cssProp, newCssVal);
    },
    /**
     * Computes a new value according to given weight.
     * @param {float}  value
     * @param {float}  weight
     * @return {float}
     */
    cssDimensionAdapt: function(value, weight) {
      // if a design value is 0, then we couldn't adapt it...    
      var multiplier = 1 + weight;
      return (value > 0 ? value * multiplier : multiplier);
    },
    /**
     * Get the CSS style of a DOM element, after all styles are applied to the page. 
     * @param {object} domElem DOM element.
     * @param {string} cssProp CSS property.
     * @return {mixed}         Value of CSS property.
     */
    getStyle: function (domElem, cssProp) {
      var cssValue = "";
      // normalize
      cssProp = cssProp.toLowerCase();
      /*if (domElem.style[cssProp]) { // inline CSS
        cssValue = domElem.style[cssProp];
      } else*/ 
      if (window.getComputedStyle) { // W3C
        cssValue = window.getComputedStyle(domElem, null).getPropertyValue(cssProp);
      } else if (domElem.currentStyle) { // IE: font-size -> fontSize
        cssProp = this.dash2camel(cssProp);
        cssValue = domElem.currentStyle[cssProp];
      }

      return cssValue;
    }, 
    /**
     * Set a CSS style for a given DOM element.
     * @param {object} domElem  DOM element
     * @param {string} cssProp  CSS property
     * @param {string} cssValue CSS value
     * @return void     
     */    
    setStyle: function (domElem, cssProp, cssValue) {
      cssProp = cssProp.toLowerCase();
      if (domElem.style.setProperty) { // W3C & IE >= 9
        // using "important" instead of null will override user-defined rules
        domElem.style.setProperty(cssProp, cssValue, "important"); 
      } else if (style.setAttribute) { // IE: font-size -> fontSize
        cssProp = this.dash2camel(cssProp);
        domElem.style.setAttribute(cssProp, cssValue);
      }   
    },
    /** 
     * Convert str with dashes to camelCaseNotation.
     * @param {string}  str  Input string.
     * @return {string}
     */
    dash2camel: function(str) {
      return str.replace(/\-(\w)/g, function(strMatch, p1){
        return p1.toUpperCase();
      });
    },
    /** 
     * R,G,B array color to hexadecimal.
     * @param {array} R,G,B values.
     * @return {int}
     */
    rgb2hex: function(rgb) {
      var r = rgb[0].toString(16); if (r.length < 2) r += r;
      var g = rgb[1].toString(16); if (g.length < 2) g += g;
      var b = rgb[2].toString(16); if (b.length < 2) b += b;

      return r+g+b;
    },
    /** 
     * R,G,B array color to decimal number.
     * @param {array} R,G,B values.
     * @return {int}
     */
    rgb2dec: function(rgb) {
      return parseInt(this.rgb2hex(rgb), 16);
    },
    /** 
     * Number to CSS color.
     * @param {int} num Decimal number
     * @return {string}
     */
    cssColor: function(num) {
      var str = Math.floor(num).toString(16);
      // zeropad 
      for (var i = str.length; i < 6; ++i) {
        str = "0" + str;
      }
      
      return "#" + str.toUpperCase();
    },  
    /** 
     * Computes a new color according to given weight.
     * @param {array} rgb     R,G,B values.
     * @param {float} weight  Weight to restyle the CSS properties of DOM element.     
     * @return {string}
     */    
    cssColorAdapt: function(rgb, weight) {
      var oldBright = this.rgbBrightness(rgb);
      //var newBright = oldBright * weight;
      var newBright = this.cssDimensionAdapt(oldBright, weight);
      // adjust
      var r,g,b,diff;      
      var csum = rgb[0] + rgb[1] + rgb[2];
      if (oldBright > newBright) {
        diff = (csum - newBright) % 255;
        r = rgb[0] - diff; if (r < 0) r = 0;
        g = rgb[1] - diff; if (g < 0) g = 0;
        b = rgb[2] - diff; if (b < 0) b = 0;
      } else {
        diff = (newBright - oldBright) % 255;
        r = rgb[0] + diff; if (r > 255) r = 255;
        g = rgb[1] + diff; if (g > 255) g = 255;
        b = rgb[2] + diff; if (b > 255) b = 255;
      }
      
      return this.cssColor(this.rgb2dec([r,g,b]));
    },
    /** 
     * Computes the brightness of a color.
     * @param {array} rgb R,G,B values.
     * @return {int}
     */    
    rgbBrightness: function(rgb) {      
      return (rgb[0]*299 + rgb[1]*587 + rgb[2]*114) / 1000;
    },
    
    rgbDifference: function(rgb1, rgb2) {
      var diff = (Math.max(rgb1[0], rgb2[0]) - Math.min(rgb1[0], rgb2[0])) + 
                 (Math.max(rgb1[1], rgb2[1]) - Math.min(rgb1[1], rgb2[1])) + 
                 (Math.max(rgb1[2], rgb2[2]) - Math.min(rgb1[2], rgb2[2]));
      return Math.abs(Math.round(diff));
    },    
    /**
     * Convert a color to an array of R,G,B values in [0,255].
     * @param color {string} color  Color definition: rgb(R,G,B) or #RGB or # RRGGBB.
     * @return {array}              R,G,B values.
     */    
    parseColor: function(color) {
      var rgb = [];
      // option 1: rgb(R, G, B) format
      if (color[0] == 'r') {
        var fparen = color.indexOf('(');
        var lparen = color.indexOf(')');
        color = color.substring(fparen+1, lparen);
        rgb = color.split(',');
        for (var j = 0; j < 3; ++j) {
          rgb[j] = parseInt(rgb[j]);
        }
      }
      // option 2: #RRGGBB format
      else if (color[0] == "#") {
        // check also the shorthand notation (#F00 = #FF0000)
        var start  = 1;
        var offset = color.length < 6 ? 1 : 2;
        for (var i = 0, col = ""; i < 3; ++i) {
          col = color.substr(start, offset);
          if (offset == 1) col += col;
          rgb[i] = parseInt(col,16);
          start += offset;
        }
      }
      // else ... bad color definition or plain name given (e.g. 'pink')
      return rgb;
    },
    /**
     * Retrieve the parts of a dimension definition (e.g. "15px", "2.5em"...)
     * @return {object}
     * @config {float}  value Value of dimension.
     * @config {string} unit  Unit of measure.
     */        
    parseDimension: function(dim) {
      var value = parseFloat(dim);
      var parts = dim.split(value);
      
      return { value:value, unit:parts[1] };
    }
    
  };

  /**
   * XPath functions. 
   * Not documented yet.
   * Code extracted from window.js @ http://code.google.com/p/xpathchecker/
   */
  var xpath = {

    queryXPath: function(document, xpath) {
      var xpathResult;
      if (typeof document.evaluate === 'function') {
        xpathResult = document.evaluate(xpath, document.documentElement, null, XPathResult.ANY_TYPE, null);
      } else {
        try {
          // IE5 and later has implemented that [0] should be the first node, 
          // but according to the W3C standard it should have been [1]!
          document.setProperty("SelectionLanguage", "XPath");
          xpathResult = document.selectNodes(xpath);
        } catch(err) {
          xpathResult = false;
        }
      }
      
      return xpathResult;
    },
    
    getXPathNodes: function(document, xpath) {
      var xpathResult = this.queryXPath(document, xpath);
      var result = [];
      var item = xpathResult.iterateNext();
      while (item) {
        result.push(item);
        item = xpathResult.iterateNext();
      }
      
      return result;
    },

    getXPath: function(targetNode) {
      var useLowerCase = (targetNode.ownerDocument instanceof HTMLDocument);
      var nodePath = this.getNodePath(targetNode);
      var nodeNames = [];
      for (var i in nodePath) {
        var nodeIndex;
        var node = nodePath[i];
        if (node.nodeType == 1) { // && node.tagName != "TBODY") {
          if (i == 0 && node.hasAttribute("id")) {
            nodeNames.push("/*[@id='" + node.getAttribute("id") + "']");
          } else {
            var tagName = node.tagName;
            if (useLowerCase) {
              tagName = tagName.toLowerCase();
            }
            nodeIndex = this.getNodeIndex(node);
            if (nodeIndex != null) {
              nodeNames.push(tagName + "[" + nodeIndex + "]");
            } else {
              nodeNames.push(tagName);
            }
          }
        } else if (node.nodeType == 3) {
          nodeIndex = this.getTextNodeIndex(node);
          if (nodeIndex != null) {
            nodeNames.push("text()[" + nodeIndex + "]");
          } else {
            nodeNames.push("text()");
          }
        }
      }
      
      return "/" + nodeNames.join("/");
    },

    getNodeIndex: function(node) {
      if (node.nodeType != 1 || node.parentNode == null) return null;
      var list = this.getChildNodesWithTagName(node.parentNode, node.tagName);
      if (list.length == 1 && list[0] == node) return null;
      for (var i = 0; i < list.length; i++) {
          if (list[i] == node) return i + 1;
      }
      
      throw "couldn't find node in parent's list: " + node.tagName;
    },

    getTextNodeIndex: function(node) {
      var list = this.getChildTextNodes(node.parentNode)
      if (list.length == 1 && list[0] == node) return null;
      for (var i = 0; i < list.length; i++) {
          if (list[i] == node) return i + 1;
      }
      
      throw "couldn't find node in parent's list: " + node.tagName;
    },

    getChildNodesWithTagName: function(parent, tagName) {
      var result = [];
      var child = parent.firstChild;
      while (child != null) {
        if (child.tagName && child.tagName == tagName) {
          result.push(child);
        }
        child = child.nextSibling;
      }
      
      return result;
    },

    getChildTextNodes: function(parent) {
      var result = [];
      var child = parent.firstChild;
      while (child != null) {
        if (child.nodeType == 3) {
          result.push(child);
        }
        child = child.nextSibling;
      }
      
      return result;
    },

    getNodePath: function(node) {
      var result = [];
      while (node.nodeType == 1 || node.nodeType == 3) {
          result.unshift(node);
          if (node.nodeType == 1 && node.hasAttribute("id")) return result;
          node = node.parentNode;
      }
      
      return result;
    },
    
    getNodeValues: function(resultList) {
      var result = [];
      for (var i in resultList) {
        result.push(resultList[i].nodeValue);
      }
      
      return result;
    }
  
  };

  /**
   * Cookies management object.
   * This cookies object allows to store and retrieve cookies easily.
   */
  var cookies = {
    /**
     * Stores a cookie variable.
     * @param {string} name
     * @param {mixed}  value
     * @param {string} [expiredays] default: session lifetime
     * @param {string} [domainpath] default: root domain
     * @param {string} [secure] default: root domain     
     * @return void
     */
    set: function(name,value,expiredays,domainpath,secure) {
      domainpath = domainpath || "/";
      secure = "; secure" || "";
      var expires = "";
      if (expiredays) {
        var date = new Date();
        date.setTime(date.getTime() + (expiredays*24*60*60*1000)); // ms
        expires = "; expires=" + date.toGMTString();
      }
      document.cookie = name +"="+ escape(value) + expires +"; path=" + domainpath;
    },
    /**
     * Retrieves a cookie variable.
     * @param {string} name Cookie name
     * @return {string}     Cookie value, or false on failure.
     */
    get: function(name) {
      var cStart,cEnd;
      if (document.cookie.length > 0) {
        cStart = document.cookie.indexOf(name+"=");
        if (cStart != -1) {
          cStart = cStart + name.length + 1;
          cEnd   = document.cookie.indexOf(";", cStart);
          if (cEnd == -1) {
            cEnd = document.cookie.length;
          }
          return unescape(document.cookie.substring(cStart, cEnd));
        }
      }
      return false;
    },
    /**
     * Deletes a cookie.
     * @param {string}  name  Cookie name.
     * @return void     
     */
    del: function(name) {
      if (this.get(name)) {
        this.set(name, null, -1);
      }
    }
  };

  /**
   * Event handling object.
   * This object can be used to manage every UI action.
   */
  var events = {
    /**
     * Adds event listeners unobtrusively.
     * @author John Resig http://ejohn.org
     * @param {object}    obj   Object to add listener(s) to.
     * @param {string}    type  Event type.
     * @param {function}  fn    Function to execute.
     * @return void
     */  
    add: function(obj, type, fn) {
      if (obj.addEventListener) { // W3C standard
        obj.addEventListener(type, fn, false);
      } else if (obj.attachEvent)	{ // IE versions
        obj["e"+type+fn] = fn;
        obj[type+fn] = function(){ obj["e"+type+fn](window.event); };
        obj.attachEvent("on"+type, obj[type+fn]);
      }
    },
    /**
     * Removes event listeners unobtrusively.
     * @author John Resig http://ejohn.org     
     * @param {object}    obj   Object to remove listener(s) from
     * @param {string}    type  Event type
     * @param {function}  fn    Function to remove from event
     * @return void
     */    
    remove: function(obj, type, fn) {
      if (obj.removeEventListener) { // W3C standard
        obj.removeEventListener(type, fn, false);
      } else if (obj.detachEvent)	{ // IE versions
        obj.detachEvent("on"+type, obj[type+fn]);      
        obj[type+fn] = null;
      }
    },
    /**
     * Handles mouse events.
     * @param {object}  e Event.
     * @return void     
     */
    mouseHandler: function(e) {
      fn.updateRank(e);
    }, 
    /**
     * Handles keyboard events.
     * @param {object}  e Event.     
     * @return void     
     */    
    keyHandler: function(e) {
      fn.updateRank(e);
    },
    /**
     * Handles window events.
     * @param {object}  e Event.     
     * @return void     
     */    
    winHandler: function(e) {
      fn.updateRank(e);
    },    
    /**
     * Handles touch events.
     * @param {object}  e Event.
     * @return void     
     */    
    touchHandler: function(e) {
      var touch = e.touches[0] || e.targetTouches[0];
      // remove (emulated) mouse events on mobile devices
      switch(e.type) {
        case "touchstart": 
        case "touchmove":
        case "touchend":
          events.remove(document, e.type, events.mouseHandler);
          events.mouseHandler(touch);
          break;
        default: 
          return;
      }
    },
    /** 
     * ACE events configuration.
     * @config {object}   priorities  Event priorities in JSON format.
     * @config {boolean}  defaults    Keep default event binding (with unitary weighting).
     */      
    config: {
      priorities: {},
      defaults: true
    },
    /** 
     * Set ACE weights.
     * @param {object}    ctx DOM context.
     * @param {string}    ev  Event type.
     * @param {function}  fn  Function to bind event.
     * @return void     
     */    
    init: function(ctx, ev, fn) {
      if (ev in this.config.priorities && this.config.priorities[ev] > 0) {
        // Custom weighting has been set
        this.add(ctx, ev, fn);
      } else if (this.config.defaults && typeof this.config.priorities[ev] === 'undefined') {
        // Use default weighting
        this.config.priorities[ev] = 1;
        this.add(ctx, ev, fn);
      }
    },
    /** 
     * Set ACE events.  
     * @param {object}  ctx DOM context.     
     * @return void     
     */
    initAll: function(context) {
      var mouseEvts = ["mousedown", "mouseup", "mousemove", "click", "scroll", "mousewheel"],
          touchEvts = ["touchstart", "touchend", "touchmove"],
          keyEvts   = ["keydown", "keyup", "keypress"],
          winEvts   = ["blur", "focus", "resize"],
          i, ev;
                
      for (i = 0; i < mouseEvts.length; ++i) {
        this.init(context, mouseEvts[i], events.mouseHandler);
      }
      for (i = 0; i < touchEvts.length; ++i) {
        this.init(context, touchEvts[i], events.touchHandler);
      }
      for (i = 0; i < keyEvts.length; ++i) {
        this.init(context, keyEvts[i], events.keyHandler);
      } 
      for (i = 0; i < winEvts.length; ++i) {
        this.init(context, keyEvts[i], events.winHandler);
      }
    }
  };
  
  /**
   * Database functions.
   * This object uses localStorage by default, or a cookie as a fallback mechanism.
   */  
  var db = {
    /** 
     * Retrieves size of stored data.
     * @return {int}
     */
    size: function() {
      if (window.localStorage) {
        return localStorage.length;
      } else {
        var l = 0;
        for (var i = 0; i < document.cookie.length; ++i) {
          l += document.cookie[i].length;
        }
        return l;
      }    
    },
    /** 
     * Set value.
     * @param {string}  keyName Variable name.
     * @param {mixed}   value   New variable value.
     * @return void
     */
    set: function(keyName, value) {
      if (window.localStorage) {
        localStorage[keyName] = value;
      } else {
        cookies.set(keyName, value);
      }
    },
    /** 
     * Retrieve variable value.
     * @param {string}  keyName Variable name.
     * @return {mixed}
     */
    get: function(keyName) {
      var value = false;
      if (window.localStorage) {
        value = localStorage[keyName];
      } else {
        value = cookies.get(keyName);
      }
      return value;
    },
    /** 
     * Delete variable value.
     * @param {string}  keyName Variable name.
     * @return void
     */    
    del: function(keyName) {
      this.set(keyName, null);
    }
    
  };

  /**
   * Adaptive CSS Engine API.
   * As described in the WWW Dev Track presentation (2012).
   */  
  var ACE = {
    /**
     * Chooses which events will be tracked and which priority will they have.
     * @param {object}  objEvts       Events and priorities in JSON format.
     * @param {boolean} keepDefaults  Whether default events should be kept or not.
     * @return {object} ACE
     */
    listen: function(objEvts, keepDefaults) {
      events.config.priorities = objEvts;
      if (typeof keepDefaults !== 'undefined') {
        events.config.defaults = keepDefaults;
      }
      return this;    
    },
    /** 
     * THE adaptation method. 
     * @param {object}  config  Configuration in JSON format.
     * @param {object}  context DOM context (window.document by default).
     * @return {object} ACE
     */
    adapt: function(config, context) {
      context = context || document;
      prevRank = db.get("ace-rank");
      // parsing an undefined object prevent executing the remainder code in mobile borowsers
      if (prevRank) prevRank = JSON.parse(prevRank);
      for (var selector in config) {
        var domElements = context.querySelectorAll(selector);
        var properties  = config[selector];
        var currElem, weight;
        for (var j = 0, n = domElements.length; j < n; ++j) {
          currElem = xpath.getXPath(domElements[j]);
          for (var k = 0, m = properties.length; k < m; ++k) {
            // restyle only those specified elements that match the previously interacted ones
            if (prevRank && currElem in prevRank) {
              weight = prevRank[currElem];
              fn.restyle(domElements[j], properties[k], weight);
            }
          }
          // in any case, add events to the specified elements
          events.initAll(domElements[j]);          
        }
      }
      // watch for unload method
      var uevt = (typeof context.onbeforeunload === 'function') ? "beforeunload" : "unload";
      events.add(window, uevt, fn.saveRank);
      return this;
    }
  };
  
  // expose API
  window.ACE = ACE;

})(this, this.document);
