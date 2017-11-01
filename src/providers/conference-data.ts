import { Injectable } from "@angular/core";

import { Http } from "@angular/http";

import { UserData } from "./user-data";

import { Observable } from "rxjs/Observable";
import "rxjs/add/operator/map";
import "rxjs/add/observable/of";
import "rxjs/add/observable/fromPromise";

import umbraco from "umbraco-restapi";

@Injectable()
export class ConferenceData {
  data: any;
  client: any;
  siteConfiguration: any;

  constructor(public http: Http, public user: UserData) {
    this.siteConfiguration = {
      host: "http://localhost:8100",
      username: "pph@umbraco.dk",
      password: "farmer1234"
    };
  }

  load() {
    if (this.data) {
      return Observable.of(this.data);
    } else {
      return Observable.fromPromise(this.loadUmbracoData());
    }
  }

  async loadUmbracoData(): Promise<any> {
    var self = this;
    var umbracoClient = new umbraco.client();
    await umbracoClient.connect(this.siteConfiguration);

    var dayQuery = await umbracoClient.content.query({
      query: "//Conference/ScheduleRepository/ScheduleDay",
      page: 1
    });
    var speakerQuery = await umbracoClient.content.query({
      query: "//Conference/SpeakerRepository/Speaker",
      page: 1,
      size: 20
    });

    var data = {
      schedule: Object.values(dayQuery.data.embedded),
      speakers: []
    };

    for (var index = 0; index < data.schedule.length; index++) {
      var day = data.schedule[index];
      var timeSlotQuery = await umbracoClient.content.children(day);
      day.groups = Object.values(timeSlotQuery.data.embedded);
    }

    var speakers = Object.values(speakerQuery.data.embedded);
    for (var index = 0; index < speakers.length; index++) {
      var speaker = speakers[index];
      var d = {
        name: speaker.name,
        profilePic:
          "https://coatgarden18-com.s1.umbraco.io" +
          speaker.properties.image.properties.umbracoFile,
        twitter: speaker.properties.speakerTwitter,
        about: speaker.properties.intro,
        location: speaker.properties.title,
        id: speaker.id
      };

      data.speakers.push(d);
    }

    return this.processData(data);
  }

  processData(data: any) {
    // just some good 'ol JS fun with objects and arrays
    // build up the data by linking speakers to sessions

    this.data = {};
    this.data.schedule = [];
    this.data.tracks = [];
    this.data.speakers = data.speakers;

    data.schedule.forEach(day => {
      var scheduleDay = {
        date: day.name,
        groups: []
      };

      this.data.schedule.push(scheduleDay);

      // loop through each timeline group in the day
      day.groups.forEach((group: any) => {
        var scheduleGroup = {
          time: group.name,
          sessions: []
        };

        scheduleDay.groups.push(scheduleGroup);

        var backRoom = group.properties.backRoom;
        var mainRoom = group.properties.mainRoom;
        var theBox = group.properties.theBox;
        var theCafe = group.properties.theCafe;
        var timeslotEvent = group.properties.timeslotEvent;

        if (timeslotEvent) {
          this.processSession(timeslotEvent, scheduleGroup, "", this.data);
        } else {
          this.processSession(mainRoom, scheduleGroup, "Main room", this.data);
          this.processSession(backRoom, scheduleGroup, "Back room", this.data);
          this.processSession(theBox, scheduleGroup, "The Box", this.data);
          this.processSession(theCafe, scheduleGroup, "The Cafe", this.data);
        }
      });
    });

    return this.data;
  }

  processSession(session: any, group: any, location: string, data: any) {
    if (session) {
      var d = {
        name: session.name,
        timeStart: group.time,
        timeEnd: "",
        location: location,
        tracks: [""],
        id: session.id,
        description: session.properties.sessionOutline
      };

      if (session.properties.audience) {
        d.tracks = session.properties.audience.split(",");
        d.tracks.forEach((track: any) => {
          if (data.tracks.indexOf(track) < 0) {
            data.tracks.push(track);
          }
        });
      }

      group.sessions.push(d);
    }
  }

  getTimeline(
    dayIndex: number,
    queryText = "",
    excludeTracks: any[] = [],
    segment = "all"
  ) {
    return this.load().map((data: any) => {
      let day = data.schedule[dayIndex];
      day.shownSessions = 0;

      queryText = queryText.toLowerCase().replace(/,|\.|-/g, " ");
      let queryWords = queryText.split(" ").filter(w => !!w.trim().length);

      day.groups.forEach((group: any) => {
        group.hide = true;

        group.sessions.forEach((session: any) => {
          // check if this session should show or not
          this.filterSession(session, queryWords, excludeTracks, segment);

          if (!session.hide) {
            // if this session is not hidden then this group should show
            group.hide = false;
            day.shownSessions++;
          }
        });
      });

      return day;
    });
  }

  filterSession(
    session: any,
    queryWords: string[],
    excludeTracks: any[],
    segment: string
  ) {
    let matchesQueryText = false;
    if (queryWords.length) {
      // of any query word is in the session name than it passes the query test
      queryWords.forEach((queryWord: string) => {
        if (session.name.toLowerCase().indexOf(queryWord) > -1) {
          matchesQueryText = true;
        }
      });
    } else {
      // if there are no query words then this session passes the query test
      matchesQueryText = true;
    }

    // if any of the sessions tracks are not in the
    // exclude tracks then this session passes the track test
    let matchesTracks = false;
    session.tracks.forEach((trackName: string) => {
      if (excludeTracks.indexOf(trackName) === -1) {
        matchesTracks = true;
      }
    });

    // if the segement is 'favorites', but session is not a user favorite
    // then this session does not pass the segment test
    let matchesSegment = false;
    if (segment === "favorites") {
      if (this.user.hasFavorite(session.name)) {
        matchesSegment = true;
      }
    } else {
      matchesSegment = true;
    }

    // all tests must be true if it should not be hidden
    session.hide = !(matchesQueryText && matchesTracks && matchesSegment);
  }

  getSpeakers() {
    return this.load().map((data: any) => {
      return data.speakers.sort((a: any, b: any) => {
        let aName = a.name.split(" ").pop();
        let bName = b.name.split(" ").pop();
        return aName.localeCompare(bName);
      });
    });
  }

  getTracks() {
    return this.load().map((data: any) => {
      return data.tracks.sort();
    });
  }

  getMap() {
    return this.load().map((data: any) => {
      return data.map;
    });
  }
}
