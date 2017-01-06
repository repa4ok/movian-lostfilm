(function(plugin) {
    var PREFIX = plugin.getDescriptor().id;
    var TITLE = plugin.getDescriptor().title;
    var SYNOPSIS = plugin.getDescriptor().synopsis;
    var BASE_URL = "http://delta.lostfilm.tv";
    var LOGO = Plugin.path + "logo.png";

    var service = require("showtime/service");
    var settings = require("showtime/settings");
    var page = require("showtime/page");
    var http = require("showtime/http");
    var html = require("showtime/html");
    var io = require("native/io");
    var popup = require("native/popup");

    service.create(TITLE, PREFIX + ":start", "video", true, LOGO);

    /*
    settings.globalSettings(PREFIX, TITLE, LOGO, SYNOPSIS);
    settings.createInfo("info", LOGO, "Plugin developed by repa4ok. \n");
    settings.createString("userCookie", "Cookie пользователя", "DONT_TOUCH_THIS", function (v) {
        service.userCookie = v;
    }, true);
*/
    var store = plugin.createStore("config", true);

    plugin.addURI(PREFIX + ":start", start);
    plugin.addURI(PREFIX + ":serialInfo:(.*):(.*)", serialInfo);
    plugin.addURI(PREFIX + ":torrent:(.*):(.*):(.*)", function (page, c, s, e) {
        /*
        page.loading = true;
        var response = showtime.httpReq("http://delta.lostfilm.tv/v_search.php?c=" + c + "&s=" + s + "&e=" + e);
        var torrentsUrl = html.parse(response.toString()).root.getElementByTagName("meta")[0].attributes.getNamedItem("content")["value"].replace("0; url=", "");
        response = showtime.httpReq(torrentsUrl);
        var url720 = html.parse(response.toString()).root.getElementByClassName("inner-box--link main")[1].children[0].attributes.getNamedItem("href")["value"];
        showtime.print("url720 = " + url720);
        var x = http.request(url720);
        page.loading = false;
        page.redirect('torrent:video:data:application/x-bittorrent;base64,' + Duktape.enc('base64', x.bytes));
        */

        var response = showtime.httpReq("http://delta.lostfilm.tv/v_search.php?c=" + c + "&s=" + s + "&e=" + e);
        var torrentsUrl = html.parse(response.toString()).root.getElementByTagName("meta")[0].attributes.getNamedItem("content")["value"].replace("0; url=", "");
        response = showtime.httpReq(torrentsUrl);
        var url720 = html.parse(response.toString()).root.getElementByClassName("inner-box--link main")[1].children[0].attributes.getNamedItem("href")["value"];
        showtime.print("url720 = " + url720);
        var x = http.request(url720);
        page.loading = false;

        page.source = "videoparams:" + showtime.JSONEncode({
            canonicalUrl: PREFIX + ":torrent:" + c + ":" + s + ":" + e,
            sources: [{
                // url: "hls:http://s5.cdnapponline.com/video/d0ded7226ccd4c75/index.m3u8?cd=0&expired=1483538651&mw_pid=157&signature=dc27b10ea27897628341503386b21a47"
                url: 'torrent:video:' + url720
            }]
        });
        page.type = "video";
    });

    function start(page) {
        page.metadata.logo = LOGO;
        page.metadata.title = TITLE;

        page.model.contents = "list";
        page.loading = true;
        // need to move to separate function

        page.options.createMultiOpt('quality', 'Quality', [
            ['qSD',  'SD', true],
            ['qHD',       'HD'],
            ['qFHD',      'Full HD']], 
            function(order) {
                // do nothing
            },
            true);

        if (checkCookies()) {
            applyCookies();
            populateMainPage(page);
        } else if (performLogin(page)) {
            applyCookies();
            populateMainPage(page);
        } else {
            page.error("Login failed.");
            return;
        }
        
        page.type = "directory";
        page.loading = false;
    }

    function checkCookies() {
        //var response = showtime.httpReq("http://delta.lostfilm.tv");
        showtime.print("CHECK COOCKIES: ");
        showtime.print(store.userCookie);
        // if (response.multiheaders["Set-Cookie"]) {
            // saveUserCookie(response.multiheaders);
            // return true;
        // } else {
            // return false;
        // }
        return store.userCookie && store.userCookie != "DONT_TOUCH_THIS";
    }

    function applyCookies() {
        plugin.addHTTPAuth("http://.*\\.lostfilm\\.tv", function(req) {
            req.setHeader("Cookie", store.userCookie);
            req.setHeader('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0');
        });
    }

    function populateMainPage(page) {
        page.appendItem("", "separator", {
            title: "Favorites"
        });

        var response = showtime.httpReq("http://delta.lostfilm.tv/series/?type=search&s=2&t=99");
        var serialsListDiv = html.parse(response.toString()).root.getElementById("serials_list");
        var serialsList = serialsListDiv.getElementByClassName(["row"]);
        for (var i = 0; i < serialsList.length; ++i) {
            var currentSerialBody = serialsList[i].getElementByClassName(["body"])[0];
            var currentSerialName = currentSerialBody.getElementByClassName(["name-ru"])[0].textContent;
            var currentSerialLink = serialsList[i].getElementByClassName(["no-decoration"])[0].attributes.getNamedItem("href")["value"];
            page.appendItem(PREFIX + ":serialInfo:" + currentSerialName + ":" + currentSerialLink, "directory", {
                title: currentSerialName
            });
        }

        page.appendItem("", "separator", {
            title: "Popular"
        });

        response = showtime.httpReq("http://delta.lostfilm.tv/series/?type=search&s=1&t=0");
        serialsListDiv = html.parse(response.toString()).root.getElementById("serials_list");
        serialsList = serialsListDiv.getElementByClassName(["row"]);
        for (var i = 0; i < serialsList.length; ++i) {
            var currentSerialBody = serialsList[i].getElementByClassName(["body"])[0];
            var currentSerialName = currentSerialBody.getElementByClassName(["name-ru"])[0].textContent;
            var currentSerialLink = serialsList[i].getElementByClassName(["no-decoration"])[0].attributes.getNamedItem("href")["value"];
            page.appendItem(PREFIX + ":serialInfo:" + currentSerialName + ":" + currentSerialLink, "directory", {
                title: currentSerialName
            });
        }
    }


var iso8601DurationRegex = /(-)?P(?:([\.,\d]+)Y)?(?:([\.,\d]+)M)?(?:([\.,\d]+)W)?(?:([\.,\d]+)D)?T(?:([\.,\d]+)H)?(?:([\.,\d]+)M)?(?:([\.,\d]+)S)?/;

function parseISO8601Duration(s) {
  var m = s.match(iso8601DurationRegex);

  return (m[8] === undefined ? 0 : m[8]) * 1 +
    (m[7] === undefined ? 0 : m[7]) * 60 +
    (m[6] === undefined ? 0 : m[6]) * 3600 +
    (m[5] === undefined ? 0 : m[5]) * 86400;
};

    function serialInfo(page, serialName, url) {
        page.metadata.logo = LOGO;
        page.metadata.title = serialName;
        page.model.contents = "list";
        page.type = "directory";
        page.loading = true;

        var response = showtime.httpReq("http://delta.lostfilm.tv/" + url + "/seasons/");
        var seasonsList = html.parse(response.toString()).root.getElementByClassName("serie-block");
        for (var i = 0; i < seasonsList.length; ++i) {
            var seasonName = seasonsList[i].getElementByTagName("h2")[0].textContent;
            showtime.print("LOSTFILM: season name: " + seasonName);
            page.appendItem("", "separator", {
                title: seasonName
            })
            var seasonSeries = seasonsList[i].getElementByTagName("tr");
            for (var j = 0; j < seasonSeries.length; ++j) {
                if (seasonSeries[j].attributes.length > 0) {
                    continue;
                }
                var serieDiv = seasonSeries[j].getElementByClassName(["gamma"])[0].children[0];
                var serieDirtyName = serieDiv.textContent.trim();
                var serieNativeName = serieDiv.getElementByTagName("span")[0].textContent;
                var serieName = (seasonSeries.length - j) + ": " + serieDirtyName.replace(serieNativeName, "") + " (" + serieNativeName + ")";
                var serieAttrs = seasonSeries[j].getElementByClassName(["zeta"])[0].children[0].attributes.getNamedItem("onclick")["value"].replace("PlayEpisode('", "").replace("')", "").split("','");
                page.appendItem(PREFIX + ":torrent:" + serieAttrs[0] + ":" + serieAttrs[1] + ":" + serieAttrs[2], "video", {
                    title: serieName,
                    duration: "56:00"
                })
            }
        }

        page.loading = false;
    }

    function performLogin(page) {
        var credentials = plugin.getAuthCredentials(plugin.getDescriptor().synopsis, "Login required", true);
        var response, result;
        if (credentials.rejected) return false; //rejected by user
        if (credentials) {
            response = showtime.httpReq("http://login1.bogi.ru/login.php?referer=https://www.lostfilm.tv", {
                postdata: {
                    'login': credentials.username,
                    'password': credentials.password,
                    'module': 1,
                    'target': 'http://lostfilm.tv',
                    'repage': 'user',
                    'act': 'login'
                },
                noFollow: true,
                headers: {
                    'Upgrade-Insecure-Requests': 1,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Referer': 'http://www.lostfilm.tv',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });

            showtime.print("LOSTFILM login (phase 1) response:");
            showtime.print(response.toString());

            var bogiDom = html.parse(response.toString());
            var formAction = bogiDom.root.getElementById("b_form").attributes.getNamedItem("action");
            showtime.print("LOSTFILM login action url: " + formAction["value"]);

            var inputs = bogiDom.root.getElementById("b_form").getElementByTagName("input");
            var outputs = {};
            for (var i = 0; i < inputs.length; ++i) {
                // showtime.print("LOSTFILM login input: " + ));
                var inputName = inputs[i].attributes.getNamedItem("name");
                var inputValue = inputs[i].attributes.getNamedItem("value");
                if (inputName && inputValue) {
                    var resultName = inputName["value"];
                    var resultValue = inputValue["value"];
                    // showtime.print("LOSTFILM login input value " + i + ": [" + resultName + ":" + resultValue + "]");
                    outputs[resultName] = resultValue;
                }
            }
            // showtime.print("LOSTFILM postdata: " + JSON.stringify(outputs));

            response = showtime.httpReq(formAction["value"], {
                postdata: outputs,
                noFollow: true,
                headers: {
                    'Upgrade-Insecure-Requests': 1,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Referer': 'http://www.lostfilm.tv',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });

            saveUserCookie(response.multiheaders);
            return true;
        } else {
            return false;
        }
    }

    function saveUserCookie(headers) {
        var cookie;
        if (!headers) return false;
        cookie = headers["Set-Cookie"];
        showtime.print("LOSTFILM cookies...");
        if (cookie) {
            cookie.join("");
            showtime.print(cookie);
            store.userCookie = cookie;
        }
    }
})(this);
