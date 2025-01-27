// /pages/api/facecheck.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import FormData from 'form-data';
import fs from 'fs';
import https from 'https';
import { addPersonWithSocialsToFirestore } from '@/utils/firebase';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import axios from 'axios';



const TESTING_MODE = false;
const APITOKEN = process.env.NEXT_PUBLIC_FACECHECK_APITOKEN;

const downloadImage = (url: string, filename: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filename);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (error) => {
        reject(error);
      });
    });
  });
};


const uploadImage = async (imageData: string): Promise<Blob> => {
    const storage = getStorage();
    const imageRef = ref(storage, `images/${Date.now()}.jpg`);
  
    // Convert base64 to Blob
    const byteCharacters = atob(imageData.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {type: 'image/jpeg'});
  
    const uploadTask = uploadBytesResumable(imageRef, blob);
  
    return new Promise((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          // Progress function
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log('Upload is ' + progress + '% done');
        },
        (error) => {
          // Error function
          console.log('Error uploading image: ', error);
          reject(error);
        },
        () => {
          // Complete function
          getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
            console.log('File available at', downloadURL);
            resolve(downloadURL as unknown as Blob);
          });
        }
      );
    });
  };


const search_by_face = async (imageUrl: string): Promise<[string | null, any[] | null]> => {
  if (TESTING_MODE) {
    console.log('****** TESTING MODE search, results are inaccurate, and queue wait is long, but credits are NOT deducted ******');
  }

  const site = 'https://facecheck.id';
  const headers = {
    accept: 'application/json',
    Authorization: APITOKEN,
  };
  
  const url  = await uploadImage(imageUrl)
  // @ts-ignore
    const responseImage = await axios.get(url, { responseType: 'arraybuffer' });
    const imageData = Buffer.from(responseImage.data, 'binary');



  let form = new FormData();
  form.append('images', imageData, { filename: 'image.jpg' });
  form.append('id_search', '');

let response = await axios.post(site+'/api/upload_pic', form, { headers: {
    ...form.getHeaders(),
    'accept': 'application/json',
    'Authorization': APITOKEN
} });
response = response.data;
  console.log(response);
// @ts-ignore
  if (response.error) {
    // @ts-ignore
    return [`${response.error} (${response.code})`, null];
  }
// @ts-ignore

  const id_search = response.id_search;
  // @ts-ignore

  console.log(`${response.message} id_search=${id_search}`);
  const json_data = {
    id_search: id_search,
    with_progress: true,
    status_only: false,
    demo: TESTING_MODE,
  };
// @ts-ignore
  while (true) {
    response = await axios.post(site+'/api/search', json_data, { headers: headers });
    response = response.data;
    console.log(JSON.stringify(response));
    // @ts-ignore

    if (response?.error) {
        // @ts-ignore

      return [`${response.error} (${response?.code})`, null];
    }// @ts-ignore

    if (response?.output) {
        // @ts-ignore

      return [null, response?.output?.items];
    }
    // @ts-ignore

    console.log(`${response?.message} progress: ${response?.progress}%`);
    await new Promise(r => setTimeout(r, 1000));
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    const imageData = req.body.imageData;

    const [error, urls_images] = await search_by_face(imageData);

    if (urls_images) {
      console.log("Printing all URLs:");
      urls_images.sort((a, b) => b.score - a.score);
      const formatted_urls = urls_images.map(im => {
        const score = im.score; // 0 to 100 score how well the face is matching found image
        const url = im.url; // url to webpage where the person was found
        // const image_base64 = im.base64; // thumbnail image encoded as base64 string
        return { score, url };
      });
      addPersonWithSocialsToFirestore(formatted_urls);
      res.status(200).json(formatted_urls);
    } else {
      res.status(500).json({ error });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
