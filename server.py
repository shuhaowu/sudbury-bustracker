import re
import urllib

# BeautifulSoup for legacy reasons. This code is old!
from BeautifulSoup import BeautifulSoup
from flask import Flask, render_template, jsonify, send_file

VERSION = "2.0"

app = Flask(__name__)
app.config.from_pyfile("settings.py")
app.config.from_pyfile("settings_local.py", silent=True)

class AppURLOpener(urllib.FancyURLopener):
  version = "BetterSudburyBusTracker/{}".format(VERSION)

urllib._urlopener = AppURLOpener()

# Ogod. This is code from 2011! With some mods and commentary.
class StopNotFoundError(Exception): pass

class BusStop(object):
  """A stop object, hides all the details of interacting with the city's site"""
  # URL to get details about the stop
  QUERY_URL = "http://mybus.sudbury.ca/MobileQuery.aspx?hpl={}"
  # Regex for finding the stop name. heh
  STOPNAME_REGEX = re.compile(r"(\d{1,2}:\d{1,2})\W(.+)\W\(\d+\)", flags=re.DOTALL)
  # Regex for multiple stops found.
  MULTIPLE_STOPS_REGEX = re.compile(r"Found \d+ stops.")

  def __init__(self, stopnum):
    self.stopnum = stopnum.strip()
    self.refresh()
    if "No stop found" in self.html or self.MULTIPLE_STOPS_REGEX.search(self.html):
      raise StopNotFoundError("Stop {} was not found!".format(self.stopnum))

    # don't even. lol
    self.stopname = self.soup.findAll(attrs={"class": "s6"})[0].text
    self.stopname = self.STOPNAME_REGEX.search(self.stopname).group(2)

    self.busses = []

    for node in self._get_busses_nodes():
      self.busses.append(node.text.strip())

  def refresh(self):
    self.html = urllib.urlopen(self.QUERY_URL.format(self.stopnum)).read()
    self.soup = BeautifulSoup(self.html)

    # haha! the original code was like.. nodeparture = False. if ...: nodeparture = True
    # lolololololol xD
    # also this contained a bug before :P
    self.nodeparture = "No departures found" in self.html

  def _get_busses_nodes(self):
    # o.O
    return self.soup.findAll("td", attrs={"style" : "background-color:#000000;color:#FFFFFF"})

  def get_time(self, refresh=True):
    if refresh:
      self.refresh()
    if self.nodeparture:
      return None

    time = []
    for node in self._get_busses_nodes():
      nextBusNode = node.nextSibling.nextSibling
      nextbus = self._get_time_from_node(nextBusNode)
      nextnextbus = self._get_time_from_node(nextBusNode.nextSibling.nextSibling)
      time.append([node.text.strip(), nextbus, nextnextbus])

    return time

  def _get_time_from_node(self, node):
    if node["class"] != "s3":
      # Ideally.. i would have a way to catch this error so i can fix this bug..
      # in reality, that would be too much work
      raise RuntimeError("Parsing next bux time failed on stop {}".format(self.stopnum))

    nextbus = node.text.strip()
    if nextbus == u"--":
      return -1
    elif nextbus.lower() == u"now":
      return 0
    else:
      return nextbus

@app.after_request
def after_request(response):
  response.cache_control.no_cache = True
  return response

@app.route("/check/<stopnum>")
def check_stop(stopnum):
  """ Checks bus stop via GET. Returns JSON with info. Sample output:
      {
        "stopname": "LoEllen",
        "busses": [
          [
            "182", // i think this is bus number
            "7", // number of minutes until next bus
            -1 // 0 is now. -1 is not available.
          ]
        ],
        "nodeparture": false,
        "number": "6025"
      }
  """
  try:
    stop = BusStop(stopnum)
  except StopNotFoundError:
    return jsonify(error="Stop {} does not exist!".format(stopnum)), 400
  else:
    return jsonify(stopname=stop.stopname,
                   number=stop.stopnum,
                   busses=stop.get_time(),
                   nodeparture=stop.nodeparture)

@app.route("/manifest.webapp")
def manifest():
  return send_file("manifest.webapp", mimetype="application/x-web-app-manifest+json")

@app.route("/")
@app.route("/<path:path>")
def main(path=None):
  return render_template("home.html", ANALYTICS=app.config.get("ANALYTICS"))

if __name__ == "__main__":
  if app.debug:
    app.run(debug=True, host="", port=app.config["PORT"])
  else:
    from gevent.wsgi import WSGIServer
    server = WSGIServer((app.config["HOST"], app.config["PORT"]), app)
    server.serve_forever()

