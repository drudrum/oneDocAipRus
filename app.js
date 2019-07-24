const fs=require('fs');
const request=require('request');
const iconv=require('iconv-lite');
const urlModule = require('url');
const querystring=require('querystring');
const cliProgress = require('cli-progress');
const nodeTar = require('tar');
const PDFMerger = require('pdf-merger-js');
var sameTime = new require('./sameTime.js');
var downloadLimit=new sameTime(50);

//Разрешить любые поддельные сертификаты, например от грибова
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
process.env['NO_PROXY'] = 'www.caica.ru';

var books=[
  {
    url:'http://www.caica.ru/common/AirInter/validaip/html/menurus.htm',
    outfile:'AIPRUS1'
  },
  {
    url:'http://www.caica.ru/common/AirClassABV/validaip2/html/menurus.htm',
    outfile:'AIPRUS2'
  },
  {
    url:'http://www.caica.ru/common/AirClassGDE/validaip4/html/menurus.htm',
    outfile:'AIPRUS4'
  }
];


var re=/\"([^"]+\.pdf)\",\"([^"]+)\"/;
var bookFolders=[];
function nextBook(){
  var book=books.shift();
  var files=[];

  if (!book){
    console.log('pack folders');
    nodeTar.c({
      gzip: false,//<true|gzip options>,
      file: 'out/AIP.tar'
    },bookFolders).then(_ => {
      console.log('finish!');
    });
    return;
  }
  bookFolders.push('out/'+book.outfile);
  //return nextBook();

  var bar1 = new cliProgress.Bar({
    format: book.outfile+' [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
  }, cliProgress.Presets.shades_classic);
  request.get({url:book.url,encoding:null},(err,resp,menuBodyBuf)=>{
    if (err){
      console.log(err);
      process.exit(10);
    }

    var menuBody=iconv.decode(menuBodyBuf,'win1251').split(/\n/);
    var groups=[];
    menuBody.forEach((line)=>{
      if (!re.test(line)){
        return;
      }

      var reResult=re.exec(line);
      var fn=reResult[1];
      var dirs=fn.split(/\//g);
      dirs.pop();
      //!/2\-ad2\-rus\-unne\-069\.pdf/.test(line) &&
      //!/2\-sup\-2019\-03\_rus\.pdf/.test(line) &&
      ///\s\.pdf$/.test(reResult[1]) &&
      var group=dirs.pop();
      var g1=dirs.pop()||'';
      var g2=dirs.pop()||'';

      if (g2=='ad2' && /[a-zA-Z]{4,4}/.test(group)){
        group=group.replace(/([a-zA-Z]{2,2})([a-zA-Z]{2,2})/,'$1');
        group='aerodrome_'+group;
      }

      group=group.replace(/^(enr)([0-9\-]+)$/,'$1');
      group=group.replace(/^(gen)([0-9\-]+)$/,'$1');
      group=group.replace(/^(u[a-zA-Z])([a-zA-Z]{2,2})$/,'$1');
      //group=group.replace(/^(ad)([0-9\-]+)$/,'$1');
      //group=group.replace(/^(aip|aic|amdt)$/,'begining');


      groups.indexOf(group)==-1 && groups.push(group);

      files.push({
        group:group,
        link:urlModule.resolve(book.url,fn),
        name:reResult[2]
      });
    });

    if (files.length==0){
      console.log("Body:%s\nError, no files found",iconv.decode(menuBodyBuf,'win1251'));
      process.exit(9);
    }
    //files.splice(0, Math.floor(files.length*3/4));

    bar1.start(files.length, 0);


    //files.splice(10);
    var downloadedCnt=0;


    function finishBook(){
      bar1.stop();
      var merger = new PDFMerger();
      var group=files[0].group;

      groups.forEach((group,groupInd)=>{
        merger = new PDFMerger();
        files.forEach((file)=>{
          try{
            if (file.group==group){
              merger.add(file.pdfBuf);
              file.pdfBuf=null;
            }
          }catch(e){
            console.log('err',file.link,e);
          }
        });
        fs.mkdirSync('out/'+book.outfile,{recursive:true})
        merger.save('out/'+book.outfile+'/'+(groupInd+1)+'_'+book.outfile+'_'+group+'.pdf');
      });

      nextBook();
    }

    function getNextPdf(file){
      function tryLoad(file){
        request.get({
          url:/[а-яА-Я]/.test(file.link)?encodeURI(file.link):file.link,
          encoding:null,
          timeout:60000
        },(err,resp,pdfBuf)=>{
          err && console.log('file',file.link,err,resp && resp.statusCode,pdfBuf && pdfBuf.length);
          if (resp && resp.statusCode==200){
            if (Number(resp.headers['content-length']!=pdfBuf.length)){
              console.log('!!!WTF rather buffer size');
              tryLoad(file);
              return
            }
            file.pdfBuf=pdfBuf;
            downloadedCnt++;
            bar1.update(downloadedCnt);

            (downloadedCnt==files.length) && finishBook();
            //merger.add(pdfBuf);
          }else{
            tryLoad(file);
            return;
          }
          downloadLimit.e();
        });
      }
      downloadLimit.run(tryLoad,file);
    }

    files.forEach(getNextPdf);
    //getNextPdf();
    //urlModule.resolve(options.playlist,url);
    //console.log(menuBody);

  });
}
nextBook();
