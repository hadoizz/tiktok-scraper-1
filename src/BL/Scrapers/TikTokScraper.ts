import * as cheerio from "cheerio";
import miniget from "miniget";
import fetch, { RequestInit } from "node-fetch";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import * as puppeteer from "puppeteer";
import http from "node:http";
import https from "node:https";
import { exit } from "node:process";
import { IMusic, IUser, IVideo } from "../../Interfaces";
import { Music, User, Video } from "../Entities";

export class TTScraper {
  _cookies?: string = "";

  constructor(cookies?: string) {
    this._cookies = cookies;
  }
  /**
   * Fetches the website content and convert its content into text.
   * @param baseUrl baseUrl of the site to fetch
   * @param fetchOptions node-fetch fetch options. Optional
   * @returns Promise<cheerio.CheerioAPI>
  
  Example:
  ```ts
  const $ = await requestWebsite("https://www.amazon.de/s?k=" + "airpods")
  // => will return cheerio API Object to work with.
  
  $(".prices").each((_, value) => {
  console.log($(value).text().trim());
  });
  ```
   */
  private async requestWebsite(baseUrl: string, fetchOptions?: RequestInit) {
    const httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 20,
    });
    const httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 20,
    });

    const DefaultOptions = {
      agent: (_parsedURL: any) => {
        if (_parsedURL.protocol == "http:") {
          return httpAgent;
        } else {
          return httpsAgent;
        }
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.134 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        Cookie: `${this._cookies}`,
      },
    };

    const req = await fetch(
      `${baseUrl}`,
      fetchOptions ? fetchOptions : DefaultOptions
    );
    const res = await req.text();
    const $ = cheerio.load(res, {
      xmlMode: true,
    });
    return $;
  }

  /**
   * Extract the JSON Object from the DOM with JavaScript instead of cheerio
   * @param html string
   * @returns
   */

  private extractJSONObject(html: string) {
    const endofJson = html
      .split(`<script id="SIGI_STATE" type="application/json">`)[1]
      .indexOf("</script>");

    const InfoObject = html
      .split(`<script id="SIGI_STATE" type="application/json">`)[1]
      .slice(0, endofJson);

    return InfoObject;
  }

  /**
   * Trys to parse the JSON Object extracted from the Page HTML
   * @param content HTML DOM Content
   * @returns
   */

  private checkJSONExisting(content: string) {
    try {
      return JSON.parse(content) ? true : false;
    } catch (error) {}
  }

  /**
   * Does Tiktok Requests with headless chrome
   * @param url
   * @returns
   */

  private async requestWithPuppeteer(url: string) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    const tiktokPage = await page.goto(url);

    if (tiktokPage == null) {
      throw new Error("Could not load the desired Page!");
    }

    const html = await tiktokPage.text();

    await browser.close();
    return this.extractJSONObject(html);
  }

  /**
   * Replaces the window Object with a export string and writes the new JS file to work with the result as a JS Object
   * @param content the HTML content of the Page
   * @deprecated No need for this function anymore since Tiktok now adds the json directly to the html in a seperated script tag
   */

  private handleHTMLContent(content: string) {
    const htmlObject = content;
    const removeWindowObject = htmlObject
      .split("window['SIGI_STATE']=")[1]
      .indexOf(";window['SIGI_RETRY']=");

    const object = JSON.parse(
      htmlObject.split("window['SIGI_STATE']=")[1].slice(0, removeWindowObject)
    );
    return object;
  }

  /**
   * Checker to use Node-fetch over puppteer in case cookies were not required since it happens randomly
   * @param link
   * @returns
   */

  async TryFetch(link: string) {
    const $ = await this.requestWebsite(link);
    if (!this.checkJSONExisting($("#SIGI_STATE").text())) {
      const videoJson = await this.requestWithPuppeteer(link);
      return JSON.parse(videoJson);
    } else {
      return JSON.parse($("#SIGI_STATE").text());
    }
  }

  /**
   * Scrapes the tiktok video info from the given Link
   * @param uri tiktok video url
   * @returns Video
   */

  async video(uri: string, noWaterMark?: boolean): Promise<Video | void> {
    if (!uri) throw new Error("A video URL must be provided");
    let videoObject = await this.TryFetch(uri);
    const id = videoObject.ItemList?.video?.list[0] ?? 0;
    if (id == 0) return console.log(`Could not find the Video on Tiktok!`);
    const videoURL = noWaterMark
      ? await this.noWaterMark(videoObject.ItemModule[id].video.id)
      : videoObject.ItemModule[id].video.downloadAddr.trim();
    const videoResult: IVideo = new Video(
      videoObject.ItemModule[id].video.id,
      videoObject.ItemModule[id].desc,
      new Date(
        Number(videoObject.ItemModule[id].createTime) * 1000
      ).toLocaleDateString(),
      Number(videoObject.ItemModule[id].video.height),
      Number(videoObject.ItemModule[id].video.width),
      Number(videoObject.ItemModule[id].video.duration),
      videoObject.ItemModule[id].video.ratio,
      videoObject.ItemModule[id].stats.shareCount,
      videoObject.ItemModule[id].stats.diggCount,
      videoObject.ItemModule[id].stats.commentCount,
      videoObject.ItemModule[id].stats.playCount,
      videoURL,
      videoObject.ItemModule[id].video.cover,
      videoObject.ItemModule[id].video.dynamicCover,
      videoURL,
      videoObject.ItemModule[id].video.format,
      videoObject.ItemModule[id].nickname
    );

    return videoResult;
  }

  /**
   * Scrapes the given user page and returns all available info
   * @param username tiktok username of a user
   * @returns User
   */

  async user(username: string): Promise<User> {
    if (!username) throw new Error("Please enter a username");

    let infoObject = await this.TryFetch(`https://www.tiktok.com/@${username}`);

    const userObject = infoObject.UserModule.users[username];

    const userResult: IUser = new User(
      userObject.id,
      userObject.uniqueId,
      userObject.nickname,
      userObject.avatarLarger,
      userObject.signature.trim(),
      new Date(userObject.createTime * 1000).toLocaleDateString(),
      userObject.verified,
      userObject.secUid,
      userObject?.bioLink?.link,
      userObject.privateAccount,
      userObject.isUnderAge18,
      infoObject.UserModule.stats[username].followerCount,
      infoObject.UserModule.stats[username].followingCount,
      infoObject.UserModule.stats[username].heart,
      infoObject.UserModule.stats[username].videoCount
    );
    return userResult;
  }

  /**
   * Scrapes a user page and returns a list of all videos for this user
   * @param username tiktok username
   * @param noWaterMark whether the returned videos should be without watermark
   * @returns IVideo[]
   */

  async getAllVideosFromUser(username: string): Promise<IVideo[]> {
    if (!username) throw new Error("You must provide a username!");

    const { secretUID } = await this.user(`${username}`);

    if (!secretUID) {
      throw new Error("Couuld not find user UID!");
    }
    let cursor = "";

    const videos: IVideo[] = [];
    const resultArray = [];
    const userVideos = await this.fetchUserVideos(secretUID, cursor);

    if (userVideos?.itemList) {
      resultArray.push(userVideos.itemList);
      cursor = userVideos.cursor;
    }

    if (userVideos?.hasMore === true) {
      while (true) {
        const fetchMore = await this.fetchUserVideos(secretUID, cursor);
        resultArray.push(fetchMore.itemList);
        cursor = fetchMore.cursor;
        if (fetchMore.hasMore == false) {
          break;
        }
      }
    }

    for (const result of resultArray) {
      // const videoURL = noWaterMark
      //   ? await this.noWaterMark(videosObject.ItemModule[id].video.id)
      //   : videosObject.ItemModule[id].video.downloadAddr.trim();
      for (const video of result) {
        videos.push(
          new Video(
            video.id,
            video.desc,
            new Date(Number(video.createTime) * 1000).toLocaleDateString(),
            Number(video.video?.height),
            Number(video.video?.width),
            Number(video.video?.duration),
            video.video?.ratio,
            video?.stats?.shareCount,
            video?.stats?.diggCount,
            video?.stats?.commentCount,
            video?.stats?.playCount,
            video.video?.downloadAddr.trim(),
            video?.video?.cover,
            video?.video?.dynamicCover,
            video.video?.downloadAddr.trim(),
            video?.video?.format,
            video.author
          )
        );
      }
    }

    return videos;
  }

  /**
   * Fetches Users Post directly from the API
   * @param userUID
   * @param cursor
   * @returns JSON Object from the API
   */

  async fetchUserVideos(userUID: string, cursor: string) {
    const fetchUser = await fetch(
      `https://m.tiktok.com/api/post/item_list/?aid=1988&count=35&secUid=${userUID}&cursor=${cursor}`,
      {
        headers: {
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
          Cookie:
            "_ttp=20giOKHgEqBuTmVEAZtfn1d2hY7; ttwid=1%7CTQIxz0XiWfp7pukZEMXLVKPHz-8yYy-hFtsuP9QH6qQ%7C1666445148%7Cb9a0888038642e8181e42a5fdaac6f198842f5be356d87316064ad3bf1f53e33; _abck=2C43FEAB6D7433C06BC6BA58A7ABDFFC~-1~YAAQPeUVAveE++WDAQAAMPXe/wjYc6xTVTh4Ke+kHGxxgJfxDRcT0ee3UkTu3sYlI0/69c8OLY/v+ofiwRwfxveidVDxaESN7yjCkBHSBV2dseB7rOBVUGyOtm1hGsf/hGHEVHVopulk0NAeiJoOWsARcJDql0k07Qhcv2pmP5lYQ17fhi75Lm6tFGCSwl+O9+idv5u8yCSf675M33/mdm5vuhXjPHCASZIjZVftaPqSdJdEDy6Z772SQ3VwQhMMOMpF51aj29e99OCtMRPM3bmbda16q4UAo2m8guw0c3HxhdCTYd/R7MmqDbr51KPRFFYiGmSJj49PstRweWQY4WjaAO+0Bx9ejfYha7dp1Cp/54sYHlI2oYIpTh9c9x2NbNRlFBEghhWK+d4=~-1~-1~-1; cookie-consent={%22ga%22:true%2C%22af%22:true%2C%22fbp%22:true%2C%22lip%22:true%2C%22bing%22:true%2C%22ttads%22:true%2C%22reddit%22:true%2C%22version%22:%22v8%22}; msToken=2ly4AKsEPS3tqqICLrucL3vfxEGgfhV8yzbp4ntCJRwbL0qBr1HGS-39CmfhhfoJgh9AjO-ZZw8yPTeh7VLiaRHPjEFNe-C4p0itrLBHjbjrrnc2vk19rUJNgefqanCQvlY5zg==; bm_sz=F7CD2096F100E2BBF898F75FB340B07E~YAAQPeUVAviE++WDAQAAMPXe/xGNyQyHT0csQ+5X+XBNhPNWpfB37e3Cc+Cy6ca1L3bb3+xVQCSUzwOAZt3AfYCmfis2wGK9oUPRr+6Osp3ZBR2QFOyQX7e3HU8optmJ0xHZV0D6MZc4YzD0xlxoFSkjOxb754ZanGbuFyLJgPCXD926sCOgNBQuGx6Zgk29NwARbeoupgQrRptG/t6eFoJcDA3vL+nHqMpm6XtIXV7i4O5kXn7+E+eCybbMVhkTt+qTnMfot7ULa1NNQSDaQgwZa1UIw8eKs71dyE0cikQFjc4=~4473158~3354937; tt_csrf_token=cBoP4X6a-FRM6sy440ir5_77ij4DfchzNfWQ",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:106.0) Gecko/20100101 Firefox/106.0",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      }
    );
    return await fetchUser.json();
  }

  /**
   * Scrapes the given Link and returns information about the Music of the Video
   * @param link tiktok video url
   * @returns Music
   */
  async getMusic(link: string): Promise<Music> {
    if (!link) throw new Error("You must provide a link!");

    let musicObject: any = await this.TryFetch(link);

    const id = musicObject.ItemList.video.list[0];

    const music: IMusic = new Music(
      musicObject.ItemModule[id].music.id,
      musicObject.ItemModule[id].music.title,
      musicObject.ItemModule[id].music.playUrl,
      musicObject.ItemModule[id].music.coverLarge,
      musicObject.ItemModule[id].music.coverThumb,
      musicObject.ItemModule[id].music.authorName,
      Number(musicObject.ItemModule[id].music.duration),
      musicObject.ItemModule[id].music.original,
      musicObject.ItemModule[id].music.album
    );

    return music;
  }

  /**
   * Downloads all videos from a user page!
   * @param username tiktok username of the user
   * @param options download options
   */

  async downloadAllVideosFromUser(
    username: string,
    options: {
      path?: string;
      watermark?: boolean;
    }
  ) {
    if (!username) throw new Error("Please enter a username!");

    const getAllvideos = await this.getAllVideosFromUser(username);

    if (!getAllvideos)
      throw new Error(
        "No Videos were found for this username. Either the videos are private or the user has not videos"
      );

    if (!options.path) {
      options.path = `${__dirname}/../${username}`;
      if (existsSync(options.path)) {
        console.log(`A folder with this username exists, that is unusual!`);
        try {
          unlinkSync(options.path);
        } catch (error: any) {
          console.log(
            `[ERROR] Could not remove ${options.path}\n Error Message: ${error.message}`
          );
          exit(1);
        }
      }

      if (!existsSync(options.path)) {
        mkdirSync(options.path);
      }
    }

    if (options.watermark) {
      for (const [index, video] of getAllvideos.entries()) {
        console.log(
          `Downloading Video: ${
            video.description ? video.description : video.id
          }, [${index + 1}/${getAllvideos.length}]`
        );

        let noWaterMarkLink = await this.noWaterMark(video.id);

        if (!noWaterMarkLink) {
          console.log(
            `Could not fetch ${
              video.description ? video.description : video.id
            } with no watermark`
          );
          continue;
        }

        miniget(noWaterMarkLink).pipe(
          createWriteStream(
            `${options.path}/${video.id}_${video.resolution}.${video.format}`
          )
        );
      }
      return;
    }

    for (const [index, video] of getAllvideos.entries()) {
      console.log(
        `Downloading Video: ${
          video.description ? video.description : video.id
        }, [${index + 1}/${getAllvideos.length}]`
      );

      miniget(video.downloadURL).pipe(
        createWriteStream(
          `${options.path}/${video.id}_${video.resolution}.${video.format}`
        )
      );
    }
  }

  /**
   * Returns direct download link for the video with no watermark!
   * @param link tiktok video url
   * @returns string
   */

  async noWaterMark(link: string): Promise<string | undefined | void> {
    let id: string = "";

    if (link.startsWith("https")) {
      const videoID = await this.video(link);
      if (!videoID?.id)
        return console.log(`Could not extract the Video ID from Tiktok!`);
      id = videoID.id;
    } else {
      id = link;
    }

    const fetchNoWaterInfo = await fetch(
      "https://api2.musical.ly/aweme/v1/aweme/detail/?aweme_id=" + id
    );
    const noWaterJson = await fetchNoWaterInfo.json();
    if (!noWaterJson)
      throw new Error(
        "There was an Error retrieveing this video without watermark!"
      );

    const noWaterMarkID = noWaterJson.aweme_detail.video.play_addr;

    if (!noWaterMarkID)
      throw new Error(
        "There was an Error retrieveing this video without watermark!"
      );

    return noWaterMarkID.url_list[0];
  }

  /**
   * Scrapes hashtag posts
   * @param tag tiktok hashtag
   * @returns Promise<IVideo[]>
   */

  async hashTag(tag: string): Promise<IVideo[]> {
    if (!tag)
      throw new Error("You must provide a tag name to complete the search!");

    let tagsObject = await this.TryFetch(`https://www.tiktok.com/tag/${tag}`);

    const { ItemList } = tagsObject;

    const videos: IVideo[] = [];

    for (const video of ItemList.challenge.list) {
      videos.push(
        new Video(
          tagsObject.ItemModule[video].video.id,
          tagsObject.ItemModule[video].desc,
          new Date(
            Number(tagsObject.ItemModule[video].createTime) * 1000
          ).toLocaleDateString(),
          Number(tagsObject.ItemModule[video].video.height),
          Number(tagsObject.ItemModule[video].video.width),
          Number(tagsObject.ItemModule[video].video.duration),
          tagsObject.ItemModule[video].video.ratio,
          tagsObject.ItemModule[video].stats.shareCount,
          tagsObject.ItemModule[video].stats.diggCount,
          tagsObject.ItemModule[video].stats.commentCount,
          tagsObject.ItemModule[video].stats.playCount,
          tagsObject.ItemModule[video].video.downloadAddr.trim(),
          tagsObject.ItemModule[video].video.cover,
          tagsObject.ItemModule[video].video.dynamicCover,
          tagsObject.ItemModule[video].video.playAddr.trim(),
          tagsObject.ItemModule[video].video.format,
          tagsObject.ItemModule[video].author
        )
      );
    }
    return videos;
  }
}
